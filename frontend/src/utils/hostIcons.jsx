import {
  Server, ServerCog, ServerCrash, HardDrive, HardDriveDownload, Cpu, MemoryStick, Microchip,
  Database, Cloud, CloudCog, CloudRain, CloudSnow, CloudLightning, CloudOff,
  Container, Boxes, Package, Archive, Box, FolderArchive,

  Monitor, MonitorSmartphone, MonitorPlay, Laptop, LaptopMinimal,
  Smartphone, Tablet, Tv, Watch, Webcam, Headphones, Speaker, Joystick, Gamepad2, Printer, Mouse, Keyboard,

  Terminal, TerminalSquare, Code, Code2, FileCode, FileTerminal, Braces, Binary,
  Bug, Wrench, Hammer, Cog, Settings, Settings2, Sparkles, Wand2, ToyBrick,
  GitBranch, GitMerge, GitPullRequest, GitFork, GitCommit, Github,

  Globe, Globe2, Network, Wifi, WifiOff, Signal, Radio, Antenna, Satellite, Router,
  Lock, Unlock, Key, KeyRound, Shield, ShieldCheck, ShieldAlert, ShieldOff, Fingerprint, Eye, EyeOff,

  Power, Bot, Ghost, Rocket, Coffee, Flame, Zap, ZapOff, Star, Sun, Moon, Sunrise, Sunset, CloudSun,
  Heart, Bell, Music, Camera, Image, Film, Mic, Phone, Mail, MessageCircle, Send,

  Home, Building, Building2, Briefcase, Tent, Castle, Factory, Hotel, Store, Library,
  Cat, Dog, Fish, Bird, Bug as BugIcon, Squirrel, Rabbit, Worm, Egg, Apple, Cherry, Carrot, Pizza, Beer,

  Anchor, Bike, Car, Plane, Ship, Train, Bus, Truck, Compass, Map, MapPin, Navigation,
  Atom, Beaker, FlaskConical, Telescope, Microscope, Dna, BrainCircuit, Brain,

  Activity, BarChart3, LineChart, PieChart, Gauge, Timer, AlarmClock, Hourglass,
  Award, Trophy, Crown, Medal, Flag, Bookmark, Tag, Tags, Hash, AtSign,
  Folder, FolderOpen, FolderTree, FileText, Files, BookOpen, Book,

  CircleAlert, CircleCheck, CircleX, CircleHelp, CircleDot, Hexagon, Triangle, Square, Circle, Diamond, Star as StarIcon,
} from 'lucide-react';

/**
 * 호스트/로컬 카드 + 탭 + 사이드바에서 공용으로 쓰는 아이콘 카탈로그.
 * key 가 DB/설정에 저장되는 문자열. UI 는 이 key 로 Lucide 컴포넌트를 찾는다.
 *
 * - 비어있으면 기본 아이콘 (Server / Monitor) 으로 폴백
 * - 키가 매핑에 없으면 그 문자열을 그대로 글자 (= 이모지) 로 렌더
 * - 그래서 옛 데이터에 박혀있는 이모지도 자동 호환
 *
 * 카테고리는 IconPickerPopup 의 그룹 헤더용. 키는 모든 카테고리에서 unique.
 */
export const HOST_ICON_CATEGORIES = [
  {
    label: 'Servers & Cloud',
    items: [
      { key: 'Server',          Icon: Server,           label: 'Server' },
      { key: 'ServerCog',       Icon: ServerCog,        label: 'Server cog' },
      { key: 'ServerCrash',     Icon: ServerCrash,      label: 'Server crash' },
      { key: 'HardDrive',       Icon: HardDrive,        label: 'Hard drive' },
      { key: 'HardDriveDl',     Icon: HardDriveDownload,label: 'Hard drive dl' },
      { key: 'Cpu',             Icon: Cpu,              label: 'CPU' },
      { key: 'Microchip',       Icon: Microchip,        label: 'Microchip' },
      { key: 'MemoryStick',     Icon: MemoryStick,      label: 'Memory' },
      { key: 'Database',        Icon: Database,         label: 'Database' },
      { key: 'Cloud',           Icon: Cloud,            label: 'Cloud' },
      { key: 'CloudCog',        Icon: CloudCog,         label: 'Cloud cog' },
      { key: 'CloudRain',       Icon: CloudRain,        label: 'Cloud rain' },
      { key: 'CloudSnow',       Icon: CloudSnow,        label: 'Cloud snow' },
      { key: 'CloudLightning',  Icon: CloudLightning,   label: 'Cloud lightning' },
      { key: 'CloudOff',        Icon: CloudOff,         label: 'Cloud off' },
    ],
  },
  {
    label: 'Containers & Storage',
    items: [
      { key: 'Container',     Icon: Container,    label: 'Container' },
      { key: 'Boxes',         Icon: Boxes,        label: 'Boxes' },
      { key: 'Box',           Icon: Box,          label: 'Box' },
      { key: 'Package',       Icon: Package,      label: 'Package' },
      { key: 'Archive',       Icon: Archive,      label: 'Archive' },
      { key: 'FolderArchive', Icon: FolderArchive,label: 'Folder archive' },
      { key: 'Folder',        Icon: Folder,       label: 'Folder' },
      { key: 'FolderOpen',    Icon: FolderOpen,   label: 'Folder open' },
      { key: 'FolderTree',    Icon: FolderTree,   label: 'Folder tree' },
    ],
  },
  {
    label: 'Devices',
    items: [
      { key: 'Monitor',           Icon: Monitor,           label: 'Monitor' },
      { key: 'MonitorSmartphone', Icon: MonitorSmartphone, label: 'Monitor + phone' },
      { key: 'MonitorPlay',       Icon: MonitorPlay,       label: 'Monitor play' },
      { key: 'Laptop',            Icon: Laptop,            label: 'Laptop' },
      { key: 'LaptopMinimal',     Icon: LaptopMinimal,     label: 'Laptop minimal' },
      { key: 'Smartphone',        Icon: Smartphone,        label: 'Phone' },
      { key: 'Tablet',            Icon: Tablet,            label: 'Tablet' },
      { key: 'Tv',                Icon: Tv,                label: 'TV' },
      { key: 'Watch',             Icon: Watch,             label: 'Watch' },
      { key: 'Webcam',            Icon: Webcam,            label: 'Webcam' },
      { key: 'Headphones',        Icon: Headphones,        label: 'Headphones' },
      { key: 'Speaker',           Icon: Speaker,           label: 'Speaker' },
      { key: 'Mic',               Icon: Mic,               label: 'Mic' },
      { key: 'Keyboard',          Icon: Keyboard,          label: 'Keyboard' },
      { key: 'Mouse',             Icon: Mouse,             label: 'Mouse' },
      { key: 'Joystick',          Icon: Joystick,          label: 'Joystick' },
      { key: 'Gamepad2',          Icon: Gamepad2,          label: 'Gamepad' },
      { key: 'Printer',           Icon: Printer,           label: 'Printer' },
    ],
  },
  {
    label: 'Dev & Tools',
    items: [
      { key: 'Terminal',       Icon: Terminal,       label: 'Terminal' },
      { key: 'TerminalSquare', Icon: TerminalSquare, label: 'Terminal sq' },
      { key: 'Code',           Icon: Code,           label: 'Code' },
      { key: 'Code2',          Icon: Code2,          label: 'Code 2' },
      { key: 'FileCode',       Icon: FileCode,       label: 'File code' },
      { key: 'FileTerminal',   Icon: FileTerminal,   label: 'File terminal' },
      { key: 'Braces',         Icon: Braces,         label: 'Braces' },
      { key: 'Binary',         Icon: Binary,         label: 'Binary' },
      { key: 'Bug',            Icon: Bug,            label: 'Bug' },
      { key: 'Wrench',         Icon: Wrench,         label: 'Wrench' },
      { key: 'Hammer',         Icon: Hammer,         label: 'Hammer' },
      { key: 'Cog',            Icon: Cog,            label: 'Cog' },
      { key: 'Settings',       Icon: Settings,       label: 'Settings' },
      { key: 'Settings2',      Icon: Settings2,      label: 'Settings 2' },
      { key: 'Sparkles',       Icon: Sparkles,       label: 'Sparkles' },
      { key: 'Wand2',          Icon: Wand2,          label: 'Wand' },
      { key: 'ToyBrick',       Icon: ToyBrick,       label: 'Brick' },
      { key: 'GitBranch',      Icon: GitBranch,      label: 'Git branch' },
      { key: 'GitMerge',       Icon: GitMerge,       label: 'Git merge' },
      { key: 'GitPullRequest', Icon: GitPullRequest, label: 'Pull request' },
      { key: 'GitFork',        Icon: GitFork,        label: 'Git fork' },
      { key: 'GitCommit',      Icon: GitCommit,      label: 'Git commit' },
      { key: 'Github',         Icon: Github,         label: 'GitHub' },
    ],
  },
  {
    label: 'Network & Security',
    items: [
      { key: 'Globe',       Icon: Globe,       label: 'Globe' },
      { key: 'Globe2',      Icon: Globe2,      label: 'Globe 2' },
      { key: 'Network',     Icon: Network,     label: 'Network' },
      { key: 'Wifi',        Icon: Wifi,        label: 'WiFi' },
      { key: 'WifiOff',     Icon: WifiOff,     label: 'WiFi off' },
      { key: 'Signal',      Icon: Signal,      label: 'Signal' },
      { key: 'Radio',       Icon: Radio,       label: 'Radio' },
      { key: 'Antenna',     Icon: Antenna,     label: 'Antenna' },
      { key: 'Satellite',   Icon: Satellite,   label: 'Satellite' },
      { key: 'Router',      Icon: Router,      label: 'Router' },
      { key: 'Lock',        Icon: Lock,        label: 'Lock' },
      { key: 'Unlock',      Icon: Unlock,      label: 'Unlock' },
      { key: 'Key',         Icon: Key,         label: 'Key' },
      { key: 'KeyRound',    Icon: KeyRound,    label: 'Key round' },
      { key: 'Shield',      Icon: Shield,      label: 'Shield' },
      { key: 'ShieldCheck', Icon: ShieldCheck, label: 'Shield check' },
      { key: 'ShieldAlert', Icon: ShieldAlert, label: 'Shield alert' },
      { key: 'ShieldOff',   Icon: ShieldOff,   label: 'Shield off' },
      { key: 'Fingerprint', Icon: Fingerprint, label: 'Fingerprint' },
      { key: 'Eye',         Icon: Eye,         label: 'Eye' },
      { key: 'EyeOff',      Icon: EyeOff,      label: 'Eye off' },
    ],
  },
  {
    label: 'Symbols & Status',
    items: [
      { key: 'Power',        Icon: Power,        label: 'Power' },
      { key: 'Bot',          Icon: Bot,          label: 'Bot' },
      { key: 'Ghost',        Icon: Ghost,        label: 'Ghost' },
      { key: 'Rocket',       Icon: Rocket,       label: 'Rocket' },
      { key: 'Zap',          Icon: Zap,          label: 'Zap' },
      { key: 'ZapOff',       Icon: ZapOff,       label: 'Zap off' },
      { key: 'Flame',        Icon: Flame,        label: 'Flame' },
      { key: 'Star',         Icon: Star,         label: 'Star' },
      { key: 'Heart',        Icon: Heart,        label: 'Heart' },
      { key: 'Bell',         Icon: Bell,         label: 'Bell' },
      { key: 'Sparkles',     Icon: Sparkles,     label: 'Sparkles' },
      { key: 'CircleAlert',  Icon: CircleAlert,  label: 'Alert' },
      { key: 'CircleCheck',  Icon: CircleCheck,  label: 'Check' },
      { key: 'CircleX',      Icon: CircleX,      label: 'X' },
      { key: 'CircleHelp',   Icon: CircleHelp,   label: 'Help' },
      { key: 'CircleDot',    Icon: CircleDot,    label: 'Dot' },
      { key: 'Hexagon',      Icon: Hexagon,      label: 'Hexagon' },
      { key: 'Triangle',     Icon: Triangle,     label: 'Triangle' },
      { key: 'Square',       Icon: Square,       label: 'Square' },
      { key: 'Circle',       Icon: Circle,       label: 'Circle' },
      { key: 'Diamond',      Icon: Diamond,      label: 'Diamond' },
      { key: 'Activity',     Icon: Activity,     label: 'Activity' },
      { key: 'Gauge',        Icon: Gauge,        label: 'Gauge' },
      { key: 'Timer',        Icon: Timer,        label: 'Timer' },
      { key: 'AlarmClock',   Icon: AlarmClock,   label: 'Alarm' },
      { key: 'Hourglass',    Icon: Hourglass,    label: 'Hourglass' },
      { key: 'BarChart3',    Icon: BarChart3,    label: 'Bar chart' },
      { key: 'LineChart',    Icon: LineChart,    label: 'Line chart' },
      { key: 'PieChart',     Icon: PieChart,     label: 'Pie chart' },
      { key: 'Award',        Icon: Award,        label: 'Award' },
      { key: 'Trophy',       Icon: Trophy,       label: 'Trophy' },
      { key: 'Crown',        Icon: Crown,        label: 'Crown' },
      { key: 'Medal',        Icon: Medal,        label: 'Medal' },
      { key: 'Flag',         Icon: Flag,         label: 'Flag' },
      { key: 'Bookmark',     Icon: Bookmark,     label: 'Bookmark' },
      { key: 'Tag',          Icon: Tag,          label: 'Tag' },
      { key: 'Tags',         Icon: Tags,         label: 'Tags' },
      { key: 'Hash',         Icon: Hash,         label: 'Hash' },
      { key: 'AtSign',       Icon: AtSign,       label: 'At sign' },
    ],
  },
  {
    label: 'Places',
    items: [
      { key: 'Home',      Icon: Home,      label: 'Home' },
      { key: 'Building',  Icon: Building,  label: 'Building' },
      { key: 'Building2', Icon: Building2, label: 'Building 2' },
      { key: 'Briefcase', Icon: Briefcase, label: 'Briefcase' },
      { key: 'Tent',      Icon: Tent,      label: 'Tent' },
      { key: 'Castle',    Icon: Castle,    label: 'Castle' },
      { key: 'Factory',   Icon: Factory,   label: 'Factory' },
      { key: 'Hotel',     Icon: Hotel,     label: 'Hotel' },
      { key: 'Store',     Icon: Store,     label: 'Store' },
      { key: 'Library',   Icon: Library,   label: 'Library' },
    ],
  },
  {
    label: 'Travel & Nav',
    items: [
      { key: 'Anchor',     Icon: Anchor,     label: 'Anchor' },
      { key: 'Bike',       Icon: Bike,       label: 'Bike' },
      { key: 'Car',        Icon: Car,        label: 'Car' },
      { key: 'Plane',      Icon: Plane,      label: 'Plane' },
      { key: 'Ship',       Icon: Ship,       label: 'Ship' },
      { key: 'Train',      Icon: Train,      label: 'Train' },
      { key: 'Bus',        Icon: Bus,        label: 'Bus' },
      { key: 'Truck',      Icon: Truck,      label: 'Truck' },
      { key: 'Compass',    Icon: Compass,    label: 'Compass' },
      { key: 'Map',        Icon: Map,        label: 'Map' },
      { key: 'MapPin',     Icon: MapPin,     label: 'Map pin' },
      { key: 'Navigation', Icon: Navigation, label: 'Navigation' },
    ],
  },
  {
    label: 'Nature & Life',
    items: [
      { key: 'Sun',          Icon: Sun,          label: 'Sun' },
      { key: 'Moon',         Icon: Moon,         label: 'Moon' },
      { key: 'Sunrise',      Icon: Sunrise,      label: 'Sunrise' },
      { key: 'Sunset',       Icon: Sunset,       label: 'Sunset' },
      { key: 'CloudSun',     Icon: CloudSun,     label: 'Cloud sun' },
      { key: 'Cat',          Icon: Cat,          label: 'Cat' },
      { key: 'Dog',          Icon: Dog,          label: 'Dog' },
      { key: 'Fish',         Icon: Fish,         label: 'Fish' },
      { key: 'Bird',         Icon: Bird,         label: 'Bird' },
      { key: 'Squirrel',     Icon: Squirrel,     label: 'Squirrel' },
      { key: 'Rabbit',       Icon: Rabbit,       label: 'Rabbit' },
      { key: 'Worm',         Icon: Worm,         label: 'Worm' },
      { key: 'Egg',          Icon: Egg,          label: 'Egg' },
      { key: 'Apple',        Icon: Apple,        label: 'Apple' },
      { key: 'Cherry',       Icon: Cherry,       label: 'Cherry' },
      { key: 'Carrot',       Icon: Carrot,       label: 'Carrot' },
      { key: 'Pizza',        Icon: Pizza,        label: 'Pizza' },
      { key: 'Coffee',       Icon: Coffee,       label: 'Coffee' },
      { key: 'Beer',         Icon: Beer,         label: 'Beer' },
    ],
  },
  {
    label: 'Science & Misc',
    items: [
      { key: 'Atom',         Icon: Atom,         label: 'Atom' },
      { key: 'Beaker',       Icon: Beaker,       label: 'Beaker' },
      { key: 'FlaskConical', Icon: FlaskConical, label: 'Flask' },
      { key: 'Telescope',    Icon: Telescope,    label: 'Telescope' },
      { key: 'Microscope',   Icon: Microscope,   label: 'Microscope' },
      { key: 'Dna',          Icon: Dna,          label: 'DNA' },
      { key: 'Brain',        Icon: Brain,        label: 'Brain' },
      { key: 'BrainCircuit', Icon: BrainCircuit, label: 'Brain circuit' },
      { key: 'Camera',       Icon: Camera,       label: 'Camera' },
      { key: 'Image',        Icon: Image,        label: 'Image' },
      { key: 'Film',         Icon: Film,         label: 'Film' },
      { key: 'Music',        Icon: Music,        label: 'Music' },
      { key: 'Phone',        Icon: Phone,        label: 'Phone' },
      { key: 'Mail',         Icon: Mail,         label: 'Mail' },
      { key: 'MessageCircle',Icon: MessageCircle,label: 'Message' },
      { key: 'Send',         Icon: Send,         label: 'Send' },
      { key: 'BookOpen',     Icon: BookOpen,     label: 'Book open' },
      { key: 'Book',         Icon: Book,         label: 'Book' },
      { key: 'FileText',     Icon: FileText,     label: 'File text' },
      { key: 'Files',        Icon: Files,        label: 'Files' },
    ],
  },
];

// 평탄화 (검색/매핑용). 카테고리 순서대로 따름.
export const HOST_ICON_OPTIONS = HOST_ICON_CATEGORIES.flatMap((c) => c.items);

const ICON_BY_KEY = Object.fromEntries(HOST_ICON_OPTIONS.map((opt) => [opt.key, opt]));

/** value 가 라인-아이콘 카탈로그 키인가? (이모지 호환 분기용) */
export const isLineIconKey = (value) => !!(value && ICON_BY_KEY[value]);

/**
 * 공용 렌더러.
 * - value 가 카탈로그 키면 Lucide 아이콘
 * - 아니고 value 가 있으면 (이모지/문자) 그대로 span
 * - 없으면 fallback (Server)
 */
const HostIcon = ({ value, fallback: Fallback = Server, size = 18, strokeWidth = 1.8, style }) => {
  const opt = value ? ICON_BY_KEY[value] : null;
  if (opt) {
    const { Icon } = opt;
    return <Icon size={size} strokeWidth={strokeWidth} style={style} />;
  }
  if (value) {
    return (
      <span
        aria-hidden
        style={{ fontSize: `${Math.round(size * 1.15)}px`, lineHeight: 1, ...style }}
      >
        {value}
      </span>
    );
  }
  return <Fallback size={size} strokeWidth={strokeWidth} style={style} />;
};

export default HostIcon;
