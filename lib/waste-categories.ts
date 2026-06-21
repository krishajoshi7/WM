import type { WasteType } from "@/lib/types";

export type WasteCategoryOption = {
  code: string;
  label: string;
  description: string;
};

// Category codes are stored in the database; labels explain the compliance meaning.
// Plastic categories follow India's plastic packaging EPR buckets used by CPCB.
export const wasteCategoryOptions: Record<WasteType, WasteCategoryOption[]> = {
  plastic: [
    {
      code: "PWM-CAT-I",
      label: "Plastic Category I - Rigid plastic packaging",
      description: "Rigid plastic packaging such as bottles, containers, caps, and drums."
    },
    {
      code: "PWM-CAT-II",
      label: "Plastic Category II - Flexible plastic packaging",
      description: "Flexible single-layer or plastic-only multilayer packaging."
    },
    {
      code: "PWM-CAT-III",
      label: "Plastic Category III - Multilayered plastic packaging",
      description: "Packaging with at least one plastic layer and at least one non-plastic layer."
    },
    {
      code: "PWM-CAT-IV",
      label: "Plastic Category IV - Compostable plastic packaging",
      description: "Compostable plastic carry bags, sheets, or similar packaging."
    }
  ],
  "e-waste": [
    {
      code: "EW-ITEW",
      label: "E-waste - IT and telecommunication equipment",
      description: "Computers, printers, phones, routers, and related equipment."
    },
    {
      code: "EW-CEEW",
      label: "E-waste - Consumer electrical and electronics",
      description: "Consumer electronics and photovoltaic panels covered under Schedule I."
    },
    {
      code: "EW-LSEEW",
      label: "E-waste - Large and small electrical equipment",
      description: "Household and commercial electrical equipment."
    },
    {
      code: "EW-EETW",
      label: "E-waste - Electrical and electronic tools",
      description: "Power tools and electronic tools, except large stationary industrial tools."
    },
    {
      code: "EW-MDW",
      label: "E-waste - Medical devices",
      description: "Covered medical devices, excluding implanted and infected products."
    },
    {
      code: "EW-LIW",
      label: "E-waste - Laboratory instruments",
      description: "Laboratory instruments and equipment listed under e-waste rules."
    }
  ],
  metal: [
    {
      code: "MET-FERROUS",
      label: "Metal - Ferrous scrap",
      description: "Iron and steel scrap."
    },
    {
      code: "MET-NON-FERROUS",
      label: "Metal - Non-ferrous scrap",
      description: "Aluminium, copper, brass, and other non-ferrous scrap."
    },
    {
      code: "MET-MIXED",
      label: "Metal - Mixed metal scrap",
      description: "Mixed metal stream requiring downstream segregation."
    }
  ],
  glass: [
    {
      code: "GLS-CONTAINER",
      label: "Glass - Container glass",
      description: "Bottles, jars, and packaging glass."
    },
    {
      code: "GLS-FLAT",
      label: "Glass - Flat glass",
      description: "Window, panel, or sheet glass."
    },
    {
      code: "GLS-MIXED",
      label: "Glass - Mixed cullet",
      description: "Mixed broken glass requiring sorting."
    }
  ],
  organic: [
    {
      code: "ORG-WET",
      label: "Organic - Wet biodegradable waste",
      description: "Food, market, and other biodegradable wet waste."
    },
    {
      code: "ORG-GARDEN",
      label: "Organic - Garden and horticulture waste",
      description: "Leaves, branches, trimmings, and green waste."
    },
    {
      code: "ORG-AGRI",
      label: "Organic - Agricultural residue",
      description: "Crop residue and other organic agricultural waste."
    }
  ]
};

export function getDefaultCategoryCode(wasteType: WasteType) {
  return wasteCategoryOptions[wasteType][0].code;
}

export function getWasteCategoryLabel(code: string) {
  for (const options of Object.values(wasteCategoryOptions)) {
    const match = options.find((option) => option.code === code);

    if (match) {
      return match.label;
    }
  }

  return code;
}

export function isValidWasteCategory(wasteType: WasteType, code: string) {
  return wasteCategoryOptions[wasteType]?.some((option) => option.code === code) || false;
}
