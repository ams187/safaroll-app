import type { DeviceFilter } from 'react-native-vision-camera';

/**
 * Rien dans l'app ne consomme plus de 1600 px (`writeUprightCapture` plafonne
 * là, BioCLIP retombe à 224). Le défaut de `usePhotoOutput` — 12 MP — faisait
 * payer au déclencheur 2,7 s de décodage/redressement/encodage mesurés pour
 * des pixels jetés aussitôt. 1440×1920 est le palier capteur juste au-dessus
 * du plafond — la valeur de `CommonResolutions.FHD_4_3`, écrite en clair
 * plutôt qu'importée : ce fichier est lu par `check:camera` dans un Bun nu, et
 * le moindre import de VALEUR depuis `react-native-vision-camera` y traîne
 * tout React Native, que Bun ne sait pas parser (syntaxe Flow).
 */
export const CAPTURE_PHOTO_OUTPUT = {
  targetResolution: { width: 1440, height: 1920 },
  // Le gel d'écran façon appareil photo : le capteur livre une image de
  // prévisualisation dès le DÉBUT de la capture (`onPreviewImageAvailable`),
  // affichée plein cadre pendant que la vraie photo s'écrit. Basse résolution
  // exprès — elle vit une seconde à l'écran.
  previewImageTargetSize: { width: 720, height: 960 },
} as const;

type ZoomDevice = {
  maxZoom: number;
  minZoom: number;
  zoomLensSwitchFactors: number[];
};

export const SAFARI_CAMERA_FILTER = {
  physicalDevices: ['ultra-wide-angle', 'wide-angle', 'telephoto'],
} satisfies DeviceFilter;

export function opticalZoomOptions(device: ZoomDevice | undefined): number[] {
  if (!device) return [];

  return [...new Set([device.minZoom, 1, ...device.zoomLensSwitchFactors])]
    .filter((zoom) => zoom >= device.minZoom && zoom <= device.maxZoom)
    .sort((left, right) => left - right);
}

export function formatZoom(zoom: number): string {
  return `${Number.isInteger(zoom) ? zoom : zoom.toFixed(1)}×`;
}
