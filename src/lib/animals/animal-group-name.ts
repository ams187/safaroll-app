import type { AppLanguage } from '@/i18n/languages';

type Taxonomy = { class?: string; order?: string } | undefined;

/**
 * CE QUE LA CARTE ÉCRIT SOUS « CLASSE ».
 *
 * La table est lue DEUX FOIS, l'ordre puis la classe. Un ordre n'y figure que
 * quand il dit quelque chose de plus précis que sa classe — « Papillon » vaut
 * mieux qu'« Insecte ». Sinon la classe suffit.
 *
 * TOUTE CLASSE ABSENTE RETOMBE SUR « ANIMAL », ET ÇA S'EST VU.
 *
 * Une tortue d'Hermann affichait « Animal ». Sa taxonomie est pourtant complète
 * côté serveur — mais elle porte `class: "Testudines"`, pas `"Reptilia"`, et
 * son `order` est vide. Ni l'un ni l'autre n'étaient dans la table, donc les
 * deux lectures échouaient. La grille, elle, la classait bien en reptile : elle
 * lit `species_catalog.animal_group`, une autre source, qui ne passe pas par
 * ici. D'où une carte qui se contredisait d'un écran à l'autre.
 *
 * Les classes ci-dessous ne sont pas devinées : ce sont celles réellement
 * présentes dans les captures des comptes réels, plus leurs voisines évidentes
 * (les poissons cartilagineux à côté des osseux, les bivalves à côté des
 * céphalopodes). Le vocabulaire suit celui des groupes de la collection, pour
 * qu'une carte et un filtre ne se nomment pas différemment.
 */
const LABELS = {
  fr: {
    // Ordres, quand ils sont plus parlants que leur classe.
    Coleoptera: 'Coléoptère', Hymenoptera: 'Abeille ou guêpe',
    Lepidoptera: 'Papillon', Odonata: 'Libellule',
    // Classes, groupées comme les dix groupes de la collection.
    Mammalia: 'Mammifère',
    Aves: 'Oiseau',
    Reptilia: 'Reptile', Squamata: 'Reptile', Testudines: 'Reptile',
    Crocodylia: 'Reptile', Sphenodontia: 'Reptile', Rhynchocephalia: 'Reptile',
    Amphibia: 'Amphibien',
    Actinopterygii: 'Poisson', Sarcopterygii: 'Poisson', Dipnoi: 'Poisson',
    Chondrichthyes: 'Poisson', Elasmobranchii: 'Poisson', Holocephali: 'Poisson',
    Myxini: 'Poisson', Petromyzonti: 'Poisson',
    Insecta: 'Insecte', Collembola: 'Insecte', Entognatha: 'Insecte',
    Arachnida: 'Arachnide', Merostomata: 'Arachnide', Xiphosura: 'Arachnide',
    Pycnogonida: 'Arachnide',
    Gastropoda: 'Mollusque', Bivalvia: 'Mollusque', Cephalopoda: 'Mollusque',
    Polyplacophora: 'Mollusque', Scaphopoda: 'Mollusque',
    Malacostraca: 'Crustacé', Branchiopoda: 'Crustacé', Maxillopoda: 'Crustacé',
    Hexanauplia: 'Crustacé', Ostracoda: 'Crustacé', Thecostraca: 'Crustacé',
    Anthozoa: 'Invertébré', Scyphozoa: 'Invertébré', Hydrozoa: 'Invertébré',
    Cubozoa: 'Invertébré', Asteroidea: 'Invertébré', Echinoidea: 'Invertébré',
    Holothuroidea: 'Invertébré', Ophiuroidea: 'Invertébré', Crinoidea: 'Invertébré',
    Demospongiae: 'Invertébré', Calcarea: 'Invertébré', Clitellata: 'Invertébré',
    Polychaeta: 'Invertébré', Turbellaria: 'Invertébré', Nematoda: 'Invertébré',
    Chilopoda: 'Invertébré', Diplopoda: 'Invertébré', Ascidiacea: 'Invertébré',
  },
  en: {
    Coleoptera: 'Beetle', Hymenoptera: 'Bee or wasp',
    Lepidoptera: 'Butterfly', Odonata: 'Dragonfly',
    Mammalia: 'Mammal',
    Aves: 'Bird',
    Reptilia: 'Reptile', Squamata: 'Reptile', Testudines: 'Reptile',
    Crocodylia: 'Reptile', Sphenodontia: 'Reptile', Rhynchocephalia: 'Reptile',
    Amphibia: 'Amphibian',
    Actinopterygii: 'Fish', Sarcopterygii: 'Fish', Dipnoi: 'Fish',
    Chondrichthyes: 'Fish', Elasmobranchii: 'Fish', Holocephali: 'Fish',
    Myxini: 'Fish', Petromyzonti: 'Fish',
    Insecta: 'Insect', Collembola: 'Insect', Entognatha: 'Insect',
    Arachnida: 'Arachnid', Merostomata: 'Arachnid', Xiphosura: 'Arachnid',
    Pycnogonida: 'Arachnid',
    Gastropoda: 'Mollusc', Bivalvia: 'Mollusc', Cephalopoda: 'Mollusc',
    Polyplacophora: 'Mollusc', Scaphopoda: 'Mollusc',
    Malacostraca: 'Crustacean', Branchiopoda: 'Crustacean', Maxillopoda: 'Crustacean',
    Hexanauplia: 'Crustacean', Ostracoda: 'Crustacean', Thecostraca: 'Crustacean',
    Anthozoa: 'Invertebrate', Scyphozoa: 'Invertebrate', Hydrozoa: 'Invertebrate',
    Cubozoa: 'Invertebrate', Asteroidea: 'Invertebrate', Echinoidea: 'Invertebrate',
    Holothuroidea: 'Invertebrate', Ophiuroidea: 'Invertebrate', Crinoidea: 'Invertebrate',
    Demospongiae: 'Invertebrate', Calcarea: 'Invertebrate', Clitellata: 'Invertebrate',
    Polychaeta: 'Invertebrate', Turbellaria: 'Invertebrate', Nematoda: 'Invertebrate',
    Chilopoda: 'Invertebrate', Diplopoda: 'Invertebrate', Ascidiacea: 'Invertebrate',
  },
} as const;

export function animalGroupName(taxonomy: Taxonomy, language: AppLanguage): string {
  const labels = LABELS[language] as Record<string, string>;
  return labels[taxonomy?.order ?? ''] ?? labels[taxonomy?.class ?? ''] ?? (language === 'fr' ? 'Animal' : 'Animal');
}
