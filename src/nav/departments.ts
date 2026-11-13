import {
  Aperture,
  BookOpenText,
  Brush,
  CalendarDays,
  Clapperboard,
  Compass,
  Dumbbell,
  Feather,
  FlaskConical,
  Flower2,
  GraduationCap,
  Images,
  Library,
  LineChart,
  MessageSquareText,
  Palette,
  PersonStanding,
  ScanFace,
  Scissors,
  Search,
  Settings,
  Shirt,
  ShoppingBag,
  Smile,
  Droplets,
  Stethoscope,
  Target,
  UserRound,
  Wand2,
  type LucideIcon
} from 'lucide-react';

export type DeptId =
  | 'home'
  | 'advisor'
  | 'looksmaxxing'
  | 'face'
  | 'evidence'
  | 'hair'
  | 'skin'
  | 'makeup'
  | 'dental'
  | 'fragrance'
  | 'closet'
  | 'color'
  | 'market'
  | 'fitness'
  | 'posture'
  | 'discover'
  | 'inspiration'
  | 'recreate'
  | 'tryon'
  | 'academy'
  | 'knowledge'
  | 'experiments'
  | 'calendar'
  | 'progress'
  | 'services'
  | 'media'
  | 'profile'
  | 'search'
  | 'settings';

export interface Department {
  id: DeptId;
  title: string;
  short?: string;
  path: string;
  group: string;
  icon: LucideIcon;
  /** art direction for the introduction, so departments never share one header */
  intro: 'campaign' | 'masthead' | 'study' | 'archive' | 'plate';
  /** one-line editorial positioning shown on the department entry */
  deck: string;
  /** spec part this department answers to */
  parts: string[];
  mobilePrimary?: boolean;
}

export const NAV_GROUPS = [
  'Daily',
  'Transformation',
  'Studios',
  'Wardrobe & Market',
  'Body & Presence',
  'Discovery',
  'Learning',
  'Records',
  'System'
] as const;

export const DEPARTMENTS: Department[] = [
  {
    id: 'home',
    title: 'Home Dashboard',
    short: 'Home',
    path: '/home',
    group: 'Daily',
    icon: Feather,
    intro: 'campaign',
    deck: 'Your private opening spread — where the day, the plan and the archive meet.',
    parts: ['P29'],
    mobilePrimary: true
  },
  {
    id: 'advisor',
    title: 'Glow Advisor',
    short: 'Advisor',
    path: '/advisor',
    group: 'Daily',
    icon: MessageSquareText,
    intro: 'study',
    deck: 'A consultation room that reads your own records and answers from them.',
    parts: ['P30'],
    mobilePrimary: true
  },
  {
    id: 'calendar',
    title: 'Beauty & Style Calendar',
    short: 'Calendar',
    path: '/calendar',
    group: 'Daily',
    icon: CalendarDays,
    intro: 'masthead',
    deck: 'Maintenance, appointments, retwists and preparation — one planner.',
    parts: ['P26']
  },
  {
    id: 'progress',
    title: 'Progress & Analytics',
    short: 'Progress',
    path: '/progress',
    group: 'Daily',
    icon: LineChart,
    intro: 'study',
    deck: 'Only what actually happened: photographs, metrics, consistency, milestones.',
    parts: ['P31'],
    mobilePrimary: true
  },
  {
    id: 'looksmaxxing',
    title: 'Looksmaxxing Command Center',
    short: 'Command',
    path: '/looksmaxxing',
    group: 'Transformation',
    icon: Target,
    intro: 'plate',
    deck: 'Baseline, priorities, cost–benefit ranking and the plan you are actually running.',
    parts: ['P5']
  },
  {
    id: 'face',
    title: 'Facial Aesthetics Lab',
    short: 'Face Lab',
    path: '/face',
    group: 'Transformation',
    icon: ScanFace,
    intro: 'study',
    deck: 'Standardised photography, guides, annotations — and honest limits.',
    parts: ['P6']
  },
  {
    id: 'evidence',
    title: 'Evidence Knowledge Center',
    short: 'Evidence',
    path: '/evidence',
    group: 'Transformation',
    icon: BookOpenText,
    intro: 'archive',
    deck: 'Every technique graded by evidence, cost, risk and reversibility.',
    parts: ['P7']
  },
  {
    id: 'hair',
    title: 'Hair Studio',
    short: 'Hair',
    path: '/hair',
    group: 'Studios',
    icon: Scissors,
    intro: 'campaign',
    deck: 'Locs, length, retwists, colour and a photographic hair archive.',
    parts: ['P11']
  },
  {
    id: 'skin',
    title: 'Skin & Complexion Lab',
    short: 'Skin',
    path: '/skin',
    group: 'Studios',
    icon: Droplets,
    intro: 'study',
    deck: 'Routines, introductions, reactions and ingredient reference.',
    parts: ['P12']
  },
  {
    id: 'makeup',
    title: 'Makeup Studio',
    short: 'Makeup',
    path: '/makeup',
    group: 'Studios',
    icon: Brush,
    intro: 'campaign',
    deck: 'Shades, lip combinations, placement experiments, looks built from what you own.',
    parts: ['P13']
  },
  {
    id: 'dental',
    title: 'Dental & Smile Care',
    short: 'Dental',
    path: '/dental',
    group: 'Studios',
    icon: Smile,
    intro: 'masthead',
    deck: 'Hygiene routine, appointments, questions for your dentist, expense records.',
    parts: ['P19']
  },
  {
    id: 'fragrance',
    title: 'Fragrance Studio',
    short: 'Scent',
    path: '/fragrance',
    group: 'Studios',
    icon: Flower2,
    intro: 'archive',
    deck: 'Collection, note families, longevity, layering and a scent diary.',
    parts: ['P20']
  },
  {
    id: 'closet',
    title: 'Style & Digital Closet',
    short: 'Closet',
    path: '/closet',
    group: 'Wardrobe & Market',
    icon: Shirt,
    intro: 'campaign',
    deck: 'A visual wardrobe, outfit builder, gaps, cost-per-wear and packing lists.',
    parts: ['P14']
  },
  {
    id: 'color',
    title: 'Personal Color & Style Analysis',
    short: 'Color',
    path: '/color',
    group: 'Wardrobe & Market',
    icon: Palette,
    intro: 'study',
    deck: 'Undertone exploration, palettes compared side by side, always overridable.',
    parts: ['P15']
  },
  {
    id: 'market',
    title: 'Beauty Market',
    short: 'Market',
    path: '/market',
    group: 'Wardrobe & Market',
    icon: ShoppingBag,
    intro: 'masthead',
    deck: 'Research, comparisons, Should I Buy This?, budgets and duplicate detection.',
    parts: ['P16']
  },
  {
    id: 'fitness',
    title: 'Body & Fitness',
    short: 'Body',
    path: '/fitness',
    group: 'Body & Presence',
    icon: Dumbbell,
    intro: 'study',
    deck: 'Training history, strength, optional measurements and honest nutrition education.',
    parts: ['P17']
  },
  {
    id: 'posture',
    title: 'Posture & Presentation',
    short: 'Presence',
    path: '/posture',
    group: 'Body & Presence',
    icon: PersonStanding,
    intro: 'plate',
    deck: 'Movement habits, ergonomics, camera presentation and safe mobility work.',
    parts: ['P18']
  },
  {
    id: 'discover',
    title: 'GLOW DISCOVER',
    short: 'Discover',
    path: '/discover',
    group: 'Discovery',
    icon: Compass,
    intro: 'campaign',
    deck: 'An endless dark editorial feed that learns what you actually gravitate toward.',
    parts: ['P8', 'P9'],
    mobilePrimary: true
  },
  {
    id: 'inspiration',
    title: 'Inspiration Universe',
    short: 'Boards',
    path: '/inspiration',
    group: 'Discovery',
    icon: Images,
    intro: 'archive',
    deck: 'Boards, moodboards and collage canvases for every version of your style.',
    parts: ['P25']
  },
  {
    id: 'recreate',
    title: 'Recreate This Look',
    short: 'Recreate',
    path: '/recreate',
    group: 'Discovery',
    icon: Clapperboard,
    intro: 'study',
    deck: 'Break a look into components, match against what you own, build the plan.',
    parts: ['P10']
  },
  {
    id: 'tryon',
    title: 'Virtual Try-On Studio',
    short: 'Try-On',
    path: '/tryon',
    group: 'Discovery',
    icon: Wand2,
    intro: 'plate',
    deck: 'Local, clearly-labelled simulation — never sold as a guaranteed result.',
    parts: ['P24']
  },
  {
    id: 'academy',
    title: 'Glow Academy',
    short: 'Academy',
    path: '/academy',
    group: 'Learning',
    icon: GraduationCap,
    intro: 'masthead',
    deck: 'Original tutorials, learning paths and technique practice, written properly.',
    parts: ['P21']
  },
  {
    id: 'knowledge',
    title: 'Personal Knowledge Library',
    short: 'Library',
    path: '/knowledge',
    group: 'Learning',
    icon: Library,
    intro: 'archive',
    deck: 'Notes, research, references and what personally worked — separated by evidence.',
    parts: ['P22']
  },
  {
    id: 'experiments',
    title: 'Experimentation Lab',
    short: 'Labs',
    path: '/experiments',
    group: 'Learning',
    icon: FlaskConical,
    intro: 'study',
    deck: 'Structured self-tests with baselines, protocol, observations and verdicts.',
    parts: ['P23']
  },
  {
    id: 'services',
    title: 'Professional Services & Consultation Planner',
    short: 'Consults',
    path: '/services',
    group: 'Records',
    icon: Stethoscope,
    intro: 'plate',
    deck: 'Provider records, questions, quotes and decision notes — no diagnosis, ever.',
    parts: ['P27']
  },
  {
    id: 'media',
    title: 'Private Photo & Media Studio',
    short: 'Media',
    path: '/media',
    group: 'Records',
    icon: Aperture,
    intro: 'archive',
    deck: 'Albums, standardised captures, duplicates, annotations and comparison sets.',
    parts: ['P32']
  },
  {
    id: 'profile',
    title: 'Personal Profile',
    short: 'Profile',
    path: '/profile',
    group: 'Records',
    icon: UserRound,
    intro: 'study',
    deck: 'Everything the system knows, editable, exportable and deletable.',
    parts: ['P4'],
    mobilePrimary: true
  },
  {
    id: 'search',
    title: 'Global Search',
    short: 'Search',
    path: '/search',
    group: 'System',
    icon: Search,
    intro: 'plate',
    deck: 'One query across every stored record, tag, colour and department.',
    parts: ['P28']
  },
  {
    id: 'settings',
    title: 'Settings & Integrations',
    short: 'Settings',
    path: '/settings',
    group: 'System',
    icon: Settings,
    intro: 'plate',
    deck: 'Themes, privacy, data, backups, synchronisation and authorised connections.',
    parts: ['P2', 'P34', 'P35', 'P9']
  }
];

export const DEPT_BY_ID = new Map(DEPARTMENTS.map((d) => [d.id, d]));

export function dept(id: string): Department {
  return DEPT_BY_ID.get(id as DeptId) ?? DEPARTMENTS[0];
}

export function departmentsInGroup(group: string) {
  return DEPARTMENTS.filter((d) => d.group === group);
}

export const MOBILE_PRIMARY = DEPARTMENTS.filter((d) => d.mobilePrimary).map((d) => d.id);
