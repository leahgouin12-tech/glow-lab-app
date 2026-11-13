/**
 * THE GLOW LAB — bundled reference sets.
 *
 * These are ORIGINAL commissioned images generated for this application and
 * shipped inside it. They are not scraped, not hotlinked, not stock, and they
 * are labelled as reference compositions rather than real products or real
 * people. Nothing here claims a brand, a price or an ingredient list.
 */

export interface ReferenceSet {
  slug: string;
  file: string;
  title: string;
  description: string;
  categories: string[];
  aesthetic: string;
  palette: string[];
  elements: string[];
  recreatable: boolean;
  sourceUrl: string;
  license: string;
  attribution: string;
}

export const REFERENCE_SETS: ReferenceSet[] = [
  {
    slug: 'smoke-plum-editorial',
    file: 'assets/discovery/ref-darkfem-01.webp',
    title: 'Smoke in plum, single gold',
    description:
      'A dark-feminine campaign-style face: diffused plum shadow extended past the outer corner, oxblood gloss, one metallic accent. Reference for placement, not a product list.',
    categories: ['makeup', 'brows', 'lips', 'dark feminine', 'photography'],
    aesthetic: 'dark feminine',
    palette: ['#0b0709', '#3b1e35', '#7c2340', '#c9a2ae', '#e2c49a'],
    elements: ['diffused outer-corner shadow', 'softened wing', 'glossy oxblood lip', 'single metallic earring', 'low-key lighting'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 01'
  },
  {
    slug: 'sister-locs-half-up',
    file: 'assets/discovery/ref-locs-02.webp',
    title: 'Sister locs, half-up with length',
    description:
      'Mid-thick locs gathered at the crown with face-framing pieces left out. Useful for comparing parting, root tension and length against your own archive.',
    categories: ['locs', 'protective styles', 'hair accessories', 'natural hairstyles'],
    aesthetic: 'dark feminine',
    palette: ['#120c10', '#5a3a2a', '#a9744f', '#e6d2b8'],
    elements: ['even parting grid', 'half-up gather', 'face-framing leave-outs', 'satin wrap'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 02'
  },
  {
    slug: 'knotless-cuff-braids',
    file: 'assets/discovery/ref-braids-03.webp',
    title: 'Knotless braids with cuffs',
    description:
      'Knotless pattern with curly ends and metallic cuffs threaded along the braid. A styling reference for accessory placement and parting density.',
    categories: ['braids', 'protective styles', 'hair accessories'],
    aesthetic: 'luxury',
    palette: ['#0c0a0d', '#2b2126', '#8d6b52', '#d6cfc9'],
    elements: ['knotless start', 'curly ends', 'threaded cuffs', 'low-shine finish'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 03'
  },
  {
    slug: 'vamp-oxblood-lip',
    file: 'assets/discovery/ref-vamp-04.webp',
    title: 'Vamp: oxblood and one line',
    description:
      'Minimal eye, maximal lip. The contrast is the whole look — a single sharp line above and one saturated shape below.',
    categories: ['lips', 'makeup', 'vamp', 'beauty transformations'],
    aesthetic: 'vamp',
    palette: ['#080608', '#2a0a14', '#6b1226', '#b0808a'],
    elements: ['sharp wing', 'matte oxblood lip', 'clean brow', 'low-key rim light'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 04'
  },
  {
    slug: 'champagne-chrome-manicure',
    file: 'assets/discovery/ref-nails-05.webp',
    title: 'Champagne chrome, one plum accent',
    description:
      'Almond shape, mirrored neutral, single dark nail. Shows how an accent nail changes the read of a whole hand.',
    categories: ['nails', 'accessories', 'luxury'],
    aesthetic: 'luxury',
    palette: ['#0d0a0c', '#4a3b46', '#c9b39a', '#efdfd0'],
    elements: ['almond shape', 'chrome neutral', 'accent nail', 'silk backdrop'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 05'
  },
  {
    slug: 'vanity-flatlay-dark',
    file: 'assets/discovery/ref-vanity-06.webp',
    title: 'Vanity flat lay, low light',
    description:
      'An unbranded arrangement for planning a surface that is actually usable: a short routine, a candle, one brush within reach.',
    categories: ['vanities', 'organization', 'skincare', 'lifestyle'],
    aesthetic: 'dark feminine',
    palette: ['#100c0e', '#3a2c30', '#9b7d68', '#e8d9c6'],
    elements: ['frosted glass', 'one brush', 'silk scrunchie', 'low flame'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 06'
  },
  {
    slug: 'long-coat-burgundy',
    file: 'assets/discovery/ref-fit-07.webp',
    title: 'Long coat over oxblood',
    description:
      'Proportion study: a long outer layer over a shorter line, sheer transition, one metallic stack. Everyday dark-feminine dressing.',
    categories: ['everyday outfits', 'dark feminine', 'shoes', 'accessories', '90s'],
    aesthetic: 'dark feminine',
    palette: ['#0a0a0c', '#1d1a1e', '#5c1526', '#cbbfb4'],
    elements: ['long wool coat', 'leather skirt', 'sheer layer', 'pointed boot', 'layered chains'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 07'
  },
  {
    slug: 'mcbling-velour',
    file: 'assets/discovery/ref-y2k-08.webp',
    title: 'McBling velour and chrome shades',
    description:
      'Y2K luxury: soft velour, tiny rhinestone detail, oversized reflective eyewear, small bag. A mood rather than a shopping list.',
    categories: ['y2k', 'mcbling', 'accessories', 'bags', 'streetwear'],
    aesthetic: 'y2k luxury',
    palette: ['#141018', '#b98a96', '#ded6d2', '#f2e7df'],
    elements: ['velour tracksuit', 'rhinestone detail', 'reflective shades', 'mini shoulder bag'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 08'
  },
  {
    slug: 'fragrance-still-life',
    file: 'assets/discovery/ref-fragrance-09.webp',
    title: 'Collection study: glass and shadow',
    description:
      'A storage reference for a fragrance shelf — shape variety over quantity, with room to read each bottle.',
    categories: ['fragrance collections', 'luxury lifestyle inspiration', 'organization'],
    aesthetic: 'luxury',
    palette: ['#0b090b', '#3d2a2e', '#7b5a44', '#dccdb9'],
    elements: ['heavy glass', 'lacquered cap', 'stone surface', 'single light source'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 09'
  },
  {
    slug: 'brow-macro-stroke',
    file: 'assets/discovery/ref-brow-10.webp',
    title: 'Brow macro: hair-stroke finish',
    description:
      'Close reference for a groomed brow that keeps its own hair direction — arch following the orbit, not a stencilled shape.',
    categories: ['brows', 'grooming', 'makeup placement', 'facial aesthetics'],
    aesthetic: 'editorial',
    palette: ['#100c0d', '#4a3630', '#8d6a58', '#e3d5c8'],
    elements: ['soft feathered front', 'defined tail', 'follows natural arch'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 10'
  },
  {
    slug: 'studio-row-training',
    file: 'assets/discovery/ref-fitness-11.webp',
    title: 'Single dumbbell, controlled row',
    description:
      'Movement reference for a calm strength session. Form and tempo are the subject; nothing here is a prescription.',
    categories: ['training inspiration', 'activewear', 'workout environments'],
    aesthetic: 'editorial',
    palette: ['#0d0d10', '#2a2a31', '#8b6b73', '#cfc7c2'],
    elements: ['neutral spine', 'slow eccentric', 'low-key studio light'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 11'
  },
  {
    slug: 'serum-application-texture',
    file: 'assets/discovery/ref-skincare-12.webp',
    title: 'Serum, real texture, window light',
    description:
      'Deliberately unretouched: visible pores and fine lines. Reference for what honest progress photography looks like.',
    categories: ['skincare', 'beauty', 'presentation', 'facial aesthetics'],
    aesthetic: 'editorial',
    palette: ['#0f0d0f', '#4c3f3a', '#a8938a', '#efe4d8'],
    elements: ['fingertip application', 'daylight', 'no smoothing filter'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 12'
  },
  {
    slug: 'fine-line-forearm-moon',
    file: 'assets/discovery/ref-tattoo-13.webp',
    title: 'Fine line, inner forearm',
    description:
      'Single-needle fine-line work running down the inner forearm: a crescent, a thin botanical stem, small geometric stops. Reference for line weight, spacing and how delicate work reads at real distance.',
    categories: ['tattoos', 'fine-line tattoos', 'tattoo placement', 'body art', 'arm'],
    aesthetic: 'dark feminine',
    palette: ['#100b0e', '#2b2028', '#6f5a52', '#c9a37f', '#e6d3bd'],
    elements: ['single-needle linework', 'vertical placement', 'negative space between motifs', 'no solid fill'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 13'
  },
  {
    slug: 'blackwork-shoulder-moth',
    file: 'assets/discovery/ref-tattoo-14.webp',
    title: 'Blackwork moth, shoulder to tricep',
    description:
      'Bold traditional-blackwork composition: solid black packing, ornamental filigree, stipple gradient, symmetrical moth. Reference for how much contrast a piece needs to hold up in low light.',
    categories: ['tattoos', 'blackwork tattoos', 'tattoo placement', 'body art', 'arm', 'shoulder'],
    aesthetic: 'vamp',
    palette: ['#0c0809', '#241a1c', '#4a3237', '#8a6a5c', '#d8b98c'],
    elements: ['solid black fill', 'stipple shading', 'ornamental symmetry', 'high contrast outline'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 14'
  },
  {
    slug: 'micro-tattoo-hand-set',
    file: 'assets/discovery/ref-tattoo-15.webp',
    title: 'Micro set across one hand',
    description:
      'Three small pieces sharing one hand: a hairline band on a finger, a crescent over the knuckle, a fine arc and single star on the back of the hand. Reference for scale — how small is too small to age well.',
    categories: ['tattoos', 'micro tattoos', 'tattoo placement', 'body art', 'hand'],
    aesthetic: 'editorial',
    palette: ['#14100f', '#3a2b28', '#7d6055', '#bfa08a', '#e3cdb4'],
    elements: ['sub-centimetre motifs', 'thin consistent line', 'placement follows the bone', 'sparse layout'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 15'
  },
  {
    slug: 'ear-stack-gold',
    file: 'assets/discovery/ref-pierce-16.webp',
    title: 'Ear stack, lobe to helix',
    description:
      'A layered piercing arrangement in one ear: small hoop in the lobe, thin ring mid-helix, flat-back stud higher up, plus a cuff that needs no hole. Reference for spacing between placements so the stack reads as planned.',
    categories: ['piercings', 'ear stacks', 'helix piercing', 'lobe piercing', 'jewelry', 'body art'],
    aesthetic: 'dark feminine',
    palette: ['#120d10', '#33222b', '#6b4a44', '#a8794f', '#e0c08e'],
    elements: ['mixed metal thicknesses', 'one continuous curve', 'flat-back hardware', 'cuff without a piercing'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 16'
  },
  {
    slug: 'septum-and-nostril',
    file: 'assets/discovery/ref-pierce-17.webp',
    title: 'Septum ring with one nostril hoop',
    description:
      'Lower-face crop: a thin gold septum ring, a single small nostril hoop, oxblood gloss. Reference for how facial jewelry and a dark lip share attention — one strong accent, one quiet one.',
    categories: ['piercings', 'septum rings', 'nostril rings', 'lips', 'makeup', 'body art'],
    aesthetic: 'vamp',
    palette: ['#0d090b', '#2c1a20', '#5e2030', '#9b6a55', '#d9b38a'],
    elements: ['thin-gauge ring', 'asymmetric placement', 'glossy deep lip', 'bare cheek'],
    recreatable: false,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 17'
  },
  {
    slug: 'black-tailoring-night-street',
    file: 'assets/discovery/ref-look-18.webp',
    title: 'Black tailoring, night street',
    description:
      'Oversized blazer, fitted tank, high-waisted wide-leg trouser, slim boot. Reference for a monochrome workwear silhouette that reads sharp after dark and photographs without needing colour.',
    categories: ['everyday outfits', 'dark feminine', 'tailoring', 'trousers', 'shoes', '90s'],
    aesthetic: 'dark feminine',
    palette: ['#0a0a0c', '#1d1c20', '#3a3a40', '#6d6a70', '#c8a06a'],
    elements: ['shoulder volume', 'high waist line', 'full-length trouser', 'single gold accent'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 18'
  },
  {
    slug: 'corset-and-wine-silk',
    file: 'assets/discovery/ref-look-19.webp',
    title: 'Corset over wine silk',
    description:
      'Structured black corset with visible boning against a fluid oxblood silk skirt and a fine chain belt. Reference for the hard-top / soft-bottom pairing and where a waist accent actually lands.',
    categories: ['evening outfits', 'corsetry', 'skirts', 'accessories', 'dark feminine', 'vamp'],
    aesthetic: 'vamp',
    palette: ['#0c0709', '#241016', '#5a1420', '#8c6a4a', '#d3b184'],
    elements: ['exposed boning', 'bare shoulder', 'draped fabric at hip', 'chain at the waist'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 19'
  },
  {
    slug: 'graphic-liner-double-wing',
    file: 'assets/discovery/ref-makeup-20.webp',
    title: 'Double-line wing, plum crease',
    description:
      'Macro of graphic liner: a crisp doubled wing, one dot past the outer corner, smoked plum in the crease, brushed-up brow. Reference for placement geometry you can copy with a fine brush.',
    categories: ['makeup', 'graphic eyeliner', 'eyes', 'brows', 'makeup placement'],
    aesthetic: 'editorial',
    palette: ['#0e0a0d', '#2a1a24', '#5c2f42', '#9d7a63', '#dcc3a5'],
    elements: ['two parallel lines', 'outer-corner dot', 'diffused crease colour', 'unfilled brow'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 20'
  },
  {
    slug: 'wine-color-sleek-hair',
    file: 'assets/discovery/ref-hair-21.webp',
    title: 'Wine colour, dark root grow-out',
    description:
      'Sleek centre part in deep burgundy with the natural root showing. Reference for a colour that grows out gracefully — where the tonal line sits three weeks later.',
    categories: ['hair colors', 'haircuts', 'natural hairstyles', 'dark feminine', 'beauty transformations'],
    aesthetic: 'dark feminine',
    palette: ['#0b0709', '#2a0f18', '#6b1f2e', '#a4553f', '#e0b48f'],
    elements: ['centre part', 'visible root transition', 'single specular strip', 'tucked behind one ear'],
    recreatable: true,
    sourceUrl: '',
    license: 'Glow Lab original — commissioned for this application',
    attribution: 'THE GLOW LAB reference set 21'
  }
];

/**
 * Measured pixel size of each shipped webp. Seeding writes these into the
 * media row so masonry aspect ratios come from the real file rather than a
 * guess made from the filename.
 */
export const REFERENCE_SIZES: Record<string, [number, number]> = {
  'assets/discovery/ref-darkfem-01.webp': [900, 1350],
  'assets/discovery/ref-locs-02.webp': [900, 1125],
  'assets/discovery/ref-braids-03.webp': [768, 1024],
  'assets/discovery/ref-vamp-04.webp': [900, 1350],
  'assets/discovery/ref-nails-05.webp': [900, 900],
  'assets/discovery/ref-vanity-06.webp': [900, 720],
  'assets/discovery/ref-fit-07.webp': [900, 1350],
  'assets/discovery/ref-y2k-08.webp': [768, 1024],
  'assets/discovery/ref-fragrance-09.webp': [900, 1125],
  'assets/discovery/ref-brow-10.webp': [900, 675],
  'assets/discovery/ref-fitness-11.webp': [900, 1350],
  'assets/discovery/ref-skincare-12.webp': [900, 1125]
};

export const DISCOVERY_CATEGORIES: Record<string, string[]> = {
  BEAUTY: ['Makeup', 'Skincare', 'Brows', 'Lashes', 'Lips', 'Nails', 'Grooming', 'Beauty transformations', 'Graphic eyeliner'],
  HAIR: ['Locs', 'Braids', 'Natural hairstyles', 'Haircuts', 'Colors', 'Protective styles', 'Hair accessories', 'Haircare'],
  FASHION: [
    'Y2K',
    'McBling',
    'Dark feminine',
    'Vamp',
    'Grunge',
    '90s',
    'Streetwear',
    'Luxury',
    'Everyday outfits',
    'Evening outfits',
    'Vacation outfits',
    'Accessories',
    'Shoes',
    'Bags'
  ],
  'FACIAL AESTHETICS': ['Makeup placement', 'Brow inspiration', 'Lash inspiration', 'Face-framing hairstyles', 'Accessory inspiration', 'Personal presentation'],
  'BODY ART': [
    'Tattoos',
    'Fine-line tattoos',
    'Blackwork tattoos',
    'Micro tattoos',
    'Tattoo placement',
    'Piercings',
    'Ear stacks',
    'Septum rings',
    'Nostril rings',
    'Permanent jewelry'
  ],
  LIFESTYLE: ['Bedrooms', 'Vanities', 'Organization', 'Fragrance collections', 'Personal spaces', 'Luxury lifestyle inspiration'],
  FITNESS: ['Training inspiration', 'Exercise demonstrations', 'Activewear', 'Workout environments']
};

export const AESTHETIC_IDENTITIES = ['Everyday', 'Going out', 'Professional', 'Vacation', 'Dream aesthetic', 'Experimental'] as const;
