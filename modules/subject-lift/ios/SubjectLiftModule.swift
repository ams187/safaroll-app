import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreMotion
import ExpoModulesCore
import SoundAnalysis
import UIKit
import Vision

final class ImageLoadException: Exception {
  override var reason: String { "Could not load an image from the given URI." }
}

final class UnsupportedOSException: Exception {
  override var reason: String { "Subject lifting requires iOS 17 or newer." }
}

final class RenderException: Exception {
  override var reason: String { "Failed to render the sticker image." }
}

public class SubjectLiftModule: Module {
  // Reuse a single GPU-backed context across calls.
  private let ciContext = CIContext(options: [.workingColorSpace: CGColorSpaceCreateDeviceRGB()])
  private lazy var wildlifeSounds = WildlifeSoundAnalyzer { [weak self] detection in
    self?.sendEvent("onWildlifeSound", detection)
  }
  private lazy var rangerHorizon = RangerHorizon { [weak self] update in
    self?.sendEvent("onHorizonChange", update)
  }

  public func definition() -> ModuleDefinition {
    Name("SubjectLift")
    Events("onWildlifeSound", "onHorizonChange")

    // Sound Analysis travaille directement sur les tampons du micro. Le JS ne
    // reçoit qu'une famille confirmée, jamais le son ni une donnée par frame.
    AsyncFunction("startWildlifeSoundAnalysis") { () throws -> Bool in
      try self.wildlifeSounds.start()
      return true
    }

    AsyncFunction("stopWildlifeSoundAnalysis") { () -> Bool in
      self.wildlifeSounds.stop()
      return true
    }

    AsyncFunction("startRangerHorizon") { () -> Bool in
      self.rangerHorizon.start()
    }

    AsyncFunction("stopRangerHorizon") { () -> Bool in
      self.rangerHorizon.stop()
      return true
    }

    OnAppEntersBackground {
      self.wildlifeSounds.stop()
      self.rangerHorizon.stop()
    }

    OnDestroy {
      self.wildlifeSounds.stop()
      self.rangerHorizon.stop()
    }

    AsyncFunction("liftSubject") { (uri: String) -> [String: Any] in
      guard #available(iOS 17.0, *) else {
        throw UnsupportedOSException()
      }
      return try self.lift(uri: uri)
    }

    // EST-CE UN ANIMAL — la question posée à Apple, pas à une liste.
    AsyncFunction("classifySubject") { (uri: String) -> [[String: Any]] in
      return try self.classifySubject(uri: uri)
    }

    AsyncFunction("classifyAnimal") { (uri: String) -> [String: Any] in
      return try self.classifyAnimal(uri: uri)
    }

    // Le vocabulaire du classifieur, tel qu'Apple le livre. Sert une fois, au
    // réglage : c'est lui qui dit quelles étiquettes existent réellement sur
    // cet iOS, au lieu de les deviner depuis une session WWDC.
    AsyncFunction("classifierVocabulary") { () -> [String] in
      let requete = VNClassifyImageRequest()
      let connues = try VNClassifyImageRequest.knownClassifications(
        forRevision: requete.revision
      )
      return connues.map { $0.identifier }
    }

    /*
     LE DOSSIER PARTAGÉ AVEC LES EXTENSIONS.

     Une extension est un binaire séparé, avec son propre bac à sable : elle ne
     peut PAS lire un fichier écrit par l'app. Le seul terrain commun est le
     conteneur de l'App Group, et son chemin ne se devine pas — il contient un
     identifiant tiré par le système à l'installation.

     `ExtensionStorage` de `@bacons/apple-targets` ne sait faire que du
     `UserDefaults` : ni fichier, ni chemin. D'où cette fonction, qui rend le
     dossier pour que le JavaScript y écrive l'image du deck avec
     `expo-file-system`, et que le widget la relise par `UIImage(contentsOfFile:)`.

     `nil` si le groupe n'est pas provisionné sur ce binaire — un dev client bâti
     avant que le droit n'existe. L'appelant retombe alors sur « aucune image »,
     ce qui est l'état prévu du widget.
     */
    Function("appGroupPath") { (group: String) -> String? in
      FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: group)?
        .path
    }

    // Le coach photo : uniquement les modèles Vision déjà livrés par iOS.
    // Aucun poids Core ML n'est ajouté à l'app et toute API indisponible ou en
    // échec laisse passer la capture plutôt que de perdre une rencontre.
    AsyncFunction("assessCaptureQuality") { (uri: String) throws -> [String: Any] in
      return try self.assessCaptureQuality(uri: uri)
    }
  }

  // MARK: - Coach Safari

  private func assessCaptureQuality(uri: String) throws -> [String: Any] {
    guard let cgImage = self.loadNormalizedCGImage(uri: uri) else {
      throw ImageLoadException()
    }

    var result: [String: Any] = [:]
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

    // Le sujet saillant sert aux conseils de cadrage, jamais à un refus dur :
    // un oiseau lointain peut être une excellente rencontre.
    let saliency = VNGenerateObjectnessBasedSaliencyImageRequest()
    do {
      try handler.perform([saliency])
      if let objects = saliency.results?.first?.salientObjects,
         let subject = objects.max(by: { $0.confidence < $1.confidence }) {
        let box = subject.boundingBox
        result["subjectArea"] = Double(box.width * box.height)
        result["subjectConfidence"] = Double(subject.confidence)
        result["subjectCentered"] = abs(box.midX - 0.5) <= 0.28 && abs(box.midY - 0.5) <= 0.28
        result["subjectClipped"] = box.minX <= 0.01 || box.minY <= 0.01 || box.maxX >= 0.99 || box.maxY >= 0.99
      }
    } catch {
      // Fail-open : la rencontre continue sans télémétrie de cadrage.
    }

    if #available(iOS 18.0, *) {
      let aesthetics = VNCalculateImageAestheticsScoresRequest()
      do {
        try handler.perform([aesthetics])
        if let observation = aesthetics.results?.first {
          result["aestheticsScore"] = Double(observation.overallScore)
          result["isUtility"] = observation.isUtility
        }
      } catch {
        // Fail-open : aucun mauvais verdict n'est inventé sur une erreur.
      }
    }

    return result
  }

  // MARK: - Le portail animal

  /**
   POURQUOI PAS UNE LISTE D'ÉTIQUETTES.

   Le portail précédent vivait côté serveur : on demandait à CLIP de comparer
   la photo à treize phrases « animal » et vingt phrases « pas animal », puis on
   sommait. Mesuré sur quarante images, il donnait 1.000 « animal » à une
   VOITURE et 0.945 à un tube de dentifrice — c'est-à-dire rien du tout. Et le
   défaut est structurel : un softmax sur des phrases écrites à la main ne peut
   pas couvrir le monde des objets, il ne peut que déplacer la masse.

   `VNClassifyImageRequest` est autre chose : un classifieur entraîné par Apple
   sur plus de mille catégories, dont la taxonomie est HIÉRARCHIQUE et contient
   ses propres nœuds parents. On ne lui demande pas de comparer à nos phrases,
   on lit la confiance qu'il accorde à ses propres étiquettes de haut niveau.

   ET SURTOUT, ON N'INVENTE PAS LE SEUIL. `hasMinimumPrecision(_:forRecall:)`
   interroge la courbe précision/rappel qu'Apple a mesurée POUR CETTE CLASSE.
   Demander « 90 % de précision » veut dire quelque chose de vérifié, là où
   `GATE_MIN_ANIMAL = 0.5` était un nombre choisi à la main.

   Il tourne sur le Neural Engine, hors ligne, en quelques millisecondes, et ne
   coûte rien — ni serveur, ni réseau, ni licence.
   */
  /**
   CE QU'APPLE VOIT SUR LE SUJET SEUL — ET POURQUOI CE N'EST PAS `classifyAnimal`.

   LA RÉGRESSION QUI A IMPOSÉ CETTE SÉPARATION

   Le détourage a d'abord été glissé DANS `classifyAnimal`. Résultat mesuré sur
   l'appareil : le portail est passé de ~300 ms à 634 ms, au-delà des 600 ms de
   `DELAI_PORTAIL_MS`. La course a été gagnée par le délai, `classifyAnimal` a
   rendu `null` — et le refus des peluches comme celui des photos sans animal
   ont cessé de s'appliquer, EN SILENCE. Une capture ratée ne se voyait pas ;
   un garde-fou éteint, encore moins.

   Le portail doit rester ce qu'il est : un refus rapide, plein cadre, avant le
   moindre téléversement. La classification du sujet sert à autre chose — un
   arbitre serveur — et dispose de tout le temps de l'envoi. Elle est donc
   appelée à part, sans jamais entrer dans la course.

   Rend une liste VIDE plutôt qu'une erreur quand il n'y a pas de sujet ou sous
   iOS 16 : l'appelant n'a rien à décider, le serveur n'arbitrera simplement pas.
   */
  private func classifySubject(uri: String) throws -> [[String: Any]] {
    guard let cgImage = self.loadNormalizedCGImage(uri: uri) else { throw ImageLoadException() }
    guard #available(iOS 17.0, *), let sujet = self.sujetDetoure(cgImage) else { return [] }
    let handler = VNImageRequestHandler(cgImage: sujet, options: [:])
    let requete = VNClassifyImageRequest()
    guard (try? handler.perform([requete])) != nil else { return [] }
    return (requete.results ?? [])
      .sorted { $0.confidence > $1.confidence }
      .prefix(10)
      .map { ["identifier": $0.identifier, "confidence": Double($0.confidence)] }
  }

  private func classifyAnimal(uri: String) throws -> [String: Any] {
    guard let cgImage = self.loadNormalizedCGImage(uri: uri) else {
      throw ImageLoadException()
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let requete = VNClassifyImageRequest()
    try handler.perform([requete])
    let observations = requete.results ?? []

    // Les nœuds de haut niveau de la taxonomie d'Apple. On lit leur confiance,
    // on ne les compare à rien : si le classifieur place la photo sous l'un
    // d'eux, c'est son propre verdict.
    let racines: Set<String> = [
      "animal", "bird", "mammal", "insect", "reptile", "amphibian",
      "fish", "invertebrate", "arachnid", "mollusk", "crustacean",
    ]

    var meilleure = 0.0
    var etiquette = ""
    // `hasMinimumPrecision` répond avec le point de fonctionnement mesuré par
    // Apple pour CETTE classe. Une observation qui le franchit vaut plus qu'une
    // confiance brute élevée.
    var franchitPrecision = false

    for observation in observations where racines.contains(observation.identifier) {
      let confiance = Double(observation.confidence)
      if confiance > meilleure {
        meilleure = confiance
        etiquette = observation.identifier
      }
      if observation.hasMinimumPrecision(0.9, forRecall: 0.5) {
        franchitPrecision = true
      }
    }

    // CE QUI N'EST PAS UN ANIMAL VIVANT, CHERCHÉ SUR TOUTES LES OBSERVATIONS.
    //
    // Le top 5 ne peut pas servir à ça : la taxonomie d'Apple propage la
    // confiance de la feuille jusqu'à la racine, donc un dalmatien remplit les
    // cinq places à lui seul — `animal`, `mammal`, `canine`, `dog`,
    // `dalmatian`, tous au même score. Une étiquette « peluche » n'y entre
    // jamais, même quand le classifieur la voit.
    //
    // La liste vient du vocabulaire réel de cet iOS (`classifierVocabulary`),
    // pas d'une devinette : sur 1 303 étiquettes, ce sont les quinze qui disent
    // « ce n'est pas une rencontre ». `monitor_lizard` en a été RETIRÉ — c'est
    // un varan, un vrai reptile, ramassé par erreur en cherchant « monitor ».
    let contrefacons: Set<String> = [
      // L'objet
      "stuffed_animals", "toy", "doll", "figurine", "puppet", "statue",
      "slide_toy", "train_toy", "vehicle_toy",
      // L'image d'une image
      "screenshot", "television", "computer_monitor", "painting", "illustrations",
    ]

    var faux = 0.0
    var fauxEtiquette = ""
    for observation in observations where contrefacons.contains(observation.identifier) {
      let confiance = Double(observation.confidence)
      if confiance > faux {
        faux = confiance
        fauxEtiquette = observation.identifier
      }
    }

    // Les cinq premières étiquettes, toutes catégories : c'est ce qui rend un
    // faux positif lisible après coup. Sans elles on ne saurait pas POURQUOI
    // une manette a été prise pour un animal.
    let sommet = observations
      .sorted { $0.confidence > $1.confidence }
      .prefix(5)
      .map { ["identifier": $0.identifier, "confidence": Double($0.confidence)] }

    return [
      "animalConfidence": meilleure,
      "animalLabel": etiquette,
      "fakeConfidence": faux,
      "fakeLabel": fauxEtiquette,
      "meetsApplePrecision": franchitPrecision,
      "top": sommet,
    ]
  }

  // MARK: - Pipeline

  /**
   LE SUJET SEUL, POUR LE CLASSIFIEUR.

   `lift(uri:)` fait le même travail mais pour un AUTRE usage : il rend un PNG
   pleine résolution, adouci sur les bords, destiné à la carte. Ici on ne veut
   qu'une image jetable à donner à `VNClassifyImageRequest` — d'où
   `generateMaskedImage(..., croppedToInstancesExtent: true)`, qui recadre sur
   le sujet et coûte une passe de moins.

   Rend `nil` sans bruit quand il n'y a pas de sujet : c'est un cas ordinaire
   (une photo de paysage), pas une erreur, et l'appelant s'en passe.
   */
  @available(iOS 17.0, *)
  private func sujetDetoure(_ cgImage: CGImage) -> CGImage? {
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let requete = VNGenerateForegroundInstanceMaskRequest()
    guard (try? handler.perform([requete])) != nil,
          let observation = requete.results?.first,
          !observation.allInstances.isEmpty,
          let tampon = try? observation.generateMaskedImage(
            ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: true
          )
    else { return nil }
    let image = CIImage(cvPixelBuffer: tampon)
    return CIContext().createCGImage(image, from: image.extent)
  }

  @available(iOS 17.0, *)
  private func lift(uri: String) throws -> [String: Any] {
    guard let cgImage = self.loadNormalizedCGImage(uri: uri) else {
      throw ImageLoadException()
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])

    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
      return ["hasSubject": false]
    }

    let maskBuffer = try observation.generateScaledMaskForImage(
      forInstances: observation.allInstances,
      from: handler
    )

    let original = CIImage(cgImage: cgImage)
    let maskImage = CIImage(cvPixelBuffer: maskBuffer)
      // The scaled mask matches the source resolution, but guard against any
      // off-by-a-pixel extent mismatch by clamping to the original extent.
      .cropped(to: original.extent)

    let maxDimension = max(original.extent.width, original.extent.height)
    let outlineWidth = min(max(maxDimension * 0.012, 8), 64)
    // Vision upscales a lower-res model mask to full resolution, so its edge is
    // aliased/stair-stepped. Feather + re-tighten it to anti-alias the edge.
    let edgeSoftness = min(max(maxDimension * 0.0025, 2), 14)

    // When the subject runs off the edge of the photo, the outline has to grow
    // OUTSIDE the original frame — otherwise the white border (and its rounded
    // corner) gets clipped at that edge and the cut looks flush/hard. Give the
    // whole composite that much breathing room on every side.
    let pad = ceil(outlineWidth + edgeSoftness + 2)
    let workExtent = original.extent.insetBy(dx: -pad, dy: -pad)

    // Smoothed subject matte: blur the ramp, then pull it back toward a crisp
    // edge so the subject isn't left with a hazy translucent fringe. Clamped so
    // a subject touching the frame stays solid to that edge (white sits beyond).
    let smoothMask = refineEdge(maskImage, softness: edgeSoftness, extent: original.extent, clamp: true)

    // 1. Isolate the subject onto a transparent background.
    let subjectBlend = CIFilter.blendWithMask()
    subjectBlend.inputImage = original
    subjectBlend.backgroundImage = CIImage.empty()
    subjectBlend.maskImage = smoothMask
    guard let subject = subjectBlend.outputImage else { throw RenderException() }

    // 2. Grow the mask to form the die-cut silhouette. The disc-shaped dilation
    // rounds convex corners by its radius, so where the subject meets a frame
    // edge the outline turns with a small radius instead of a hard 90°. Do NOT
    // clamp before dilating (that would flood the whole margin white); dilation
    // grows the finite mask outward by exactly `outlineWidth`.
    let dilate = CIFilter.morphologyMaximum()
    dilate.inputImage = maskImage
    dilate.radius = Float(outlineWidth)
    guard let dilatedRaw = dilate.outputImage else { throw RenderException() }
    // Soften the grown edge, unclamped so it fades to 0 at its outer boundary,
    // and keep the growth that now extends beyond the original frame.
    let dilatedMask = refineEdge(dilatedRaw, softness: edgeSoftness, extent: workExtent, clamp: false)

    // 3. Fill that grown silhouette with solid white across the expanded canvas
    // so padding can appear beyond the original photo edges.
    let white = CIImage(color: CIColor.white).cropped(to: workExtent)
    let whiteBlend = CIFilter.blendWithMask()
    whiteBlend.inputImage = white
    whiteBlend.backgroundImage = CIImage.empty()
    whiteBlend.maskImage = dilatedMask
    guard let whiteLayer = whiteBlend.outputImage else { throw RenderException() }

    // 4. Composite the subject over the white outline.
    let composite = CIFilter.sourceOverCompositing()
    composite.inputImage = subject
    composite.backgroundImage = whiteLayer
    guard let sticker = composite.outputImage?.cropped(to: workExtent) else {
      throw RenderException()
    }

    // 5. Render the expanded canvas, then crop to opaque bounds + transparent margin.
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    guard
      let fullCG = ciContext.createCGImage(
        sticker,
        from: workExtent,
        format: .RGBA8,
        colorSpace: colorSpace
      )
    else {
      throw RenderException()
    }

    let margin = Int(min(max(maxDimension * 0.05, 24), 160).rounded())
    let cropped = self.cropToOpaque(fullCG, margin: margin)

    guard
      let subjectCG = ciContext.createCGImage(
        subject.cropped(to: workExtent),
        from: workExtent,
        format: .RGBA8,
        colorSpace: colorSpace
      ),
      let subjectBounds = self.opaqueBounds(subjectCG),
      let subjectCanvas = self.cropAndPad(
        subjectCG,
        cropRect: cropped.contentBounds,
        margin: margin
      )
    else {
      throw RenderException()
    }

    let outURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("sticker-\(UUID().uuidString).png")
    let subjectURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("subject-\(UUID().uuidString).png")
    guard
      let pngData = UIImage(cgImage: cropped.image).pngData(),
      let subjectData = UIImage(cgImage: subjectCanvas).pngData()
    else {
      throw RenderException()
    }
    try pngData.write(to: outURL)
    try subjectData.write(to: subjectURL)

    let imageWidth = original.extent.width
    let imageHeight = original.extent.height
    let subjectX = max(0, min(1, (subjectBounds.minX - pad) / imageWidth))
    let subjectY = max(0, min(1, (subjectBounds.minY - pad) / imageHeight))
    let subjectWidth = max(0, min(1 - subjectX, subjectBounds.width / imageWidth))
    let subjectHeight = max(0, min(1 - subjectY, subjectBounds.height / imageHeight))
    let finalWidth = CGFloat(cropped.image.width)
    let finalHeight = CGFloat(cropped.image.height)
    let stickerSubjectX = (CGFloat(margin) + subjectBounds.minX - cropped.contentBounds.minX) / finalWidth
    let stickerSubjectY = (CGFloat(margin) + subjectBounds.minY - cropped.contentBounds.minY) / finalHeight

    return [
      "uri": outURL.absoluteString,
      "subjectUri": subjectURL.absoluteString,
      "width": cropped.image.width,
      "height": cropped.image.height,
      "hasSubject": true,
      "subjectBounds": [
        "x": subjectX,
        "y": subjectY,
        "width": subjectWidth,
        "height": subjectHeight,
        "imageWidth": imageWidth,
        "imageHeight": imageHeight,
        "stickerX": max(0, min(1, stickerSubjectX)),
        "stickerY": max(0, min(1, stickerSubjectY)),
        "stickerWidth": max(0, min(1, subjectBounds.width / finalWidth)),
        "stickerHeight": max(0, min(1, subjectBounds.height / finalHeight)),
      ],
    ]
  }

  // MARK: - Edge smoothing

  /// Anti-aliases a hard/aliased mask edge: a small Gaussian blur feathers the
  /// alpha ramp, then a contrast boost around 0.5 pulls it back toward a crisp
  /// (but now smooth) edge — a poor-man's smoothstep matte refine. Channels are
  /// scaled uniformly so it works whether the mask carries its signal in luma
  /// or alpha. `clampedToExtent` keeps the blur from darkening the borders; the
  /// result is cropped back to the source extent.
  private func refineEdge(
    _ mask: CIImage,
    softness: CGFloat,
    extent: CGRect,
    clamp: Bool = true
  ) -> CIImage {
    let blur = CIFilter.gaussianBlur()
    // Clamp for a subject matte (keep edges solid to the frame); don't clamp for
    // the outline (let it fall off to 0 beyond its grown boundary).
    blur.inputImage = clamp ? mask.clampedToExtent() : mask
    blur.radius = Float(softness)
    let blurred = blur.outputImage ?? mask

    let slope: CGFloat = 2.2
    let bias = (1 - slope) / 2
    let contrast = CIFilter.colorMatrix()
    contrast.inputImage = blurred
    contrast.rVector = CIVector(x: slope, y: 0, z: 0, w: 0)
    contrast.gVector = CIVector(x: 0, y: slope, z: 0, w: 0)
    contrast.bVector = CIVector(x: 0, y: 0, z: slope, w: 0)
    contrast.aVector = CIVector(x: 0, y: 0, z: 0, w: slope)
    contrast.biasVector = CIVector(x: bias, y: bias, z: bias, w: bias)

    // CRITICAL: the contrast matrix overshoots (1.0 -> 1.6) and undershoots
    // (0.0 -> -0.6), and CoreImage does NOT clamp intermediate values. A matte
    // value > 1 makes CIBlendWithMask multiply the subject by > 1 — blowing the
    // colors toward white and corrupting the premultiplied alpha, which is what
    // produced blown-out / hollow stickers. Clamp back to a valid [0,1] matte.
    let clampFilter = CIFilter.colorClamp()
    clampFilter.inputImage = contrast.outputImage ?? blurred
    clampFilter.minComponents = CIVector(x: 0, y: 0, z: 0, w: 0)
    clampFilter.maxComponents = CIVector(x: 1, y: 1, z: 1, w: 1)

    return (clampFilter.outputImage ?? contrast.outputImage ?? blurred).cropped(to: extent)
  }

  // MARK: - Helpers

  /// Loads the image and bakes in EXIF orientation so all downstream work is in
  /// a simple top-left pixel space.
  private func loadNormalizedCGImage(uri: String) -> CGImage? {
    let url = URL(string: uri) ?? URL(fileURLWithPath: uri)
    guard let data = try? Data(contentsOf: url), let image = UIImage(data: data) else {
      return nil
    }
    if image.imageOrientation == .up, let cg = image.cgImage {
      return cg
    }
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    let normalized = renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
    return normalized.cgImage
  }

  /// Scans the alpha channel to find the sticker's opaque bounds, then returns a
  /// copy padded with `margin` transparent pixels on every side. All coordinates
  /// are top-left (CGImage space), so there is no CIImage y-flip to reconcile.
  private struct CroppedImage {
    let image: CGImage
    let contentBounds: CGRect
  }

  private func opaqueBounds(_ cgImage: CGImage) -> CGRect? {
    let width = cgImage.width
    let height = cgImage.height

    guard
      let data = cgImage.dataProvider?.data,
      let ptr = CFDataGetBytePtr(data)
    else {
      return nil
    }
    let bytesPerRow = cgImage.bytesPerRow
    let bytesPerPixel = cgImage.bitsPerPixel / 8
    guard bytesPerPixel >= 1 else { return nil }
    let alphaOffset = bytesPerPixel - 1 // RGBA8 => alpha is the last byte

    let threshold: UInt8 = 12
    // Sample on a stride for speed on large photos; the margin absorbs the slack.
    let stride = max(1, min(width, height) / 512)

    var minX = width, minY = height, maxX = -1, maxY = -1
    var y = 0
    while y < height {
      let row = y * bytesPerRow
      var x = 0
      while x < width {
        if ptr[row + x * bytesPerPixel + alphaOffset] > threshold {
          if x < minX { minX = x }
          if x > maxX { maxX = x }
          if y < minY { minY = y }
          if y > maxY { maxY = y }
        }
        x += stride
      }
      y += stride
    }

    guard maxX >= minX, maxY >= minY else { return nil }

    let contentW = maxX - minX + 1
    let contentH = maxY - minY + 1
    return CGRect(x: minX, y: minY, width: contentW, height: contentH)
      .intersection(CGRect(x: 0, y: 0, width: width, height: height))
  }

  private func cropAndPad(_ cgImage: CGImage, cropRect: CGRect, margin: Int) -> CGImage? {
    guard !cropRect.isNull, let content = cgImage.cropping(to: cropRect) else { return nil }

    // Draw the tight crop onto a clear canvas expanded by `margin` on each side so
    // the sticker keeps its transparent breathing room even at the photo edges.
    let canvasSize = CGSize(width: content.width + margin * 2, height: content.height + margin * 2)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: canvasSize, format: format)
    let padded = renderer.image { _ in
      UIImage(cgImage: content).draw(
        in: CGRect(x: margin, y: margin, width: content.width, height: content.height)
      )
    }
    return padded.cgImage ?? content
  }

  private func cropToOpaque(_ cgImage: CGImage, margin: Int) -> CroppedImage {
    guard
      let bounds = self.opaqueBounds(cgImage),
      let image = self.cropAndPad(cgImage, cropRect: bounds, margin: margin)
    else {
      return CroppedImage(
        image: cgImage,
        contentBounds: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height)
      )
    }
    return CroppedImage(image: image, contentBounds: bounds)
  }
}

// MARK: - Horizon du ranger

private final class RangerHorizon {
  private let manager = CMMotionManager()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .userInteractive
    return queue
  }()
  private let onUpdate: ([String: Any]) -> Void
  private var lastAngle = Double.nan
  private var level = false

  init(onUpdate: @escaping ([String: Any]) -> Void) {
    self.onUpdate = onUpdate
  }

  func start() -> Bool {
    guard manager.isDeviceMotionAvailable else { return false }
    guard !manager.isDeviceMotionActive else { return true }
    manager.deviceMotionUpdateInterval = 1.0 / 12.0
    manager.startDeviceMotionUpdates(to: queue) { [weak self] motion, _ in
      guard let self, let gravity = motion?.gravity else { return }
      let angle = atan2(gravity.x, -gravity.y) * 180 / .pi
      let nextLevel = self.level ? abs(angle) <= 2.5 : abs(angle) <= 1.5
      guard nextLevel != self.level || self.lastAngle.isNaN || abs(angle - self.lastAngle) >= 0.75 else {
        return
      }
      self.level = nextLevel
      self.lastAngle = angle
      self.onUpdate(["angle": angle, "level": nextLevel])
    }
    return true
  }

  func stop() {
    manager.stopDeviceMotionUpdates()
    lastAngle = .nan
    level = false
  }
}

// MARK: - Écoute sauvage

/**
 Analyse le son ambiant avec le classifieur livré par iOS.

 Le filtre est volontairement grossier : Sound Analysis sait reconnaître une
 famille sonore, pas certifier une espèce. Deux fenêtres consécutives sont
 exigées et un cooldown évite qu'un merle transforme le viseur en sapin de Noël.
 */
private final class WildlifeSoundAnalyzer: NSObject, SNResultsObserving {
  private let engine = AVAudioEngine()
  private let onDetection: ([String: Any]) -> Void
  private var analyzer: SNAudioStreamAnalyzer?
  private var request: SNClassifySoundRequest?
  private var running = false
  private var candidate: String?
  private var confirmations = 0
  private var lastEmission = Date.distantPast

  init(onDetection: @escaping ([String: Any]) -> Void) {
    self.onDetection = onDetection
    super.init()
  }

  func start() throws {
    guard !running else { return }

    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(
        domain: "SafaRoll.WildlifeSound",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "The microphone has no readable audio format."]
      )
    }

    let stream = SNAudioStreamAnalyzer(format: format)
    let soundRequest = try SNClassifySoundRequest(classifierIdentifier: .version1)
    // Des fenêtres qui se chevauchent donnent les deux confirmations sans
    // attendre deux secondes entières, tout en filtrant un bruit isolé.
    soundRequest.windowDuration = CMTime(seconds: 0.8, preferredTimescale: 48_000)
    soundRequest.overlapFactor = 0.5
    try stream.add(soundRequest, withObserver: self)

    input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak stream] buffer, time in
      stream?.analyze(buffer, atAudioFramePosition: time.sampleTime)
    }

    do {
      engine.prepare()
      try engine.start()
      analyzer = stream
      request = soundRequest
      running = true
    } catch {
      input.removeTap(onBus: 0)
      stream.completeAnalysis()
      throw error
    }
  }

  func stop() {
    guard running || analyzer != nil else { return }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    analyzer?.completeAnalysis()
    analyzer = nil
    request = nil
    running = false
    candidate = nil
    confirmations = 0
  }

  func request(_ request: SNRequest, didProduce result: SNResult) {
    guard let result = result as? SNClassificationResult else { return }
    guard let match = result.classifications.lazy.compactMap({ classification -> (String, Double)? in
      guard classification.confidence >= 0.58,
            let family = Self.family(for: classification.identifier) else { return nil }
      return (family, Double(classification.confidence))
    }).first else {
      candidate = nil
      confirmations = 0
      return
    }

    if candidate == match.0 {
      confirmations += 1
    } else {
      candidate = match.0
      confirmations = 1
    }

    let now = Date()
    guard confirmations >= 2, now.timeIntervalSince(lastEmission) >= 5 else { return }
    lastEmission = now
    confirmations = 0
    onDetection(["kind": match.0, "confidence": match.1])
  }

  func request(_ request: SNRequest, didFailWithError error: Error) {
    candidate = nil
    confirmations = 0
  }

  func requestDidComplete(_ request: SNRequest) {}

  private static func family(for identifier: String) -> String? {
    let value = identifier
      .lowercased()
      .replacingOccurrences(of: "_", with: " ")
      .replacingOccurrences(of: "-", with: " ")

    if contains(value, ["bird", "chirp", "tweet", "squawk", "owl", "crow", "pigeon", "coo", "flapping", "goose", "duck", "turkey", "chicken"]) {
      return "bird"
    }
    if contains(value, ["frog", "croak", "toad"]) { return "frog" }
    if contains(value, ["insect", "cricket", "mosquito", "bee", "wasp", "fly buzzing"]) {
      return "insect"
    }
    if contains(value, ["lion", "tiger", "roar", "wild cat"]) { return "big_cat" }
    if contains(value, ["dog", "bark", "howl"]) { return "canid" }
    if contains(value, ["cat", "meow", "purr"]) { return "feline" }
    if contains(value, ["horse", "neigh", "cattle", "cow", "moo", "sheep", "goat", "bleat", "pig", "oink"]) {
      return "farm"
    }
    if contains(value, ["animal", "wildlife"]) { return "wildlife" }
    return nil
  }

  private static func contains(_ value: String, _ needles: [String]) -> Bool {
    needles.contains(where: value.contains)
  }
}
