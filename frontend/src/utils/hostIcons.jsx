import {
  Server, ServerCog, HardDrive, Cpu, Database, Cloud, CloudCog,
  Monitor, Laptop, Smartphone, Tablet, Container, Boxes, Package,
  Terminal, Code, Bug, Wrench, Hammer, Cog,
  Globe, Network, Wifi, Lock, Key, Shield,
  Power, Bot, Ghost, Rocket, Coffee, Flame, Zap,
} from 'lucide-react';

/**
 * 호스트/로컬 카드 + 탭 + 사이드바에서 공용으로 쓰는 아이콘 카탈로그.
 * key 가 DB/설정에 저장되는 문자열. UI 는 이 key 로 Lucide 컴포넌트를 찾는다.
 *
 * - 비어있으면 기본 아이콘 (Server / Monitor) 으로 폴백
 * - 키가 매핑에 없으면 그 문자열을 그대로 글자 (= 이모지) 로 렌더
 * - 그래서 옛 데이터에 박혀있는 이모지도 자동 호환
 */
export const HOST_ICON_OPTIONS = [
  { key: 'Server',     Icon: Server,     label: 'Server' },
  { key: 'ServerCog',  Icon: ServerCog,  label: 'Server (cog)' },
  { key: 'HardDrive',  Icon: HardDrive,  label: 'Hard drive' },
  { key: 'Cpu',        Icon: Cpu,        label: 'CPU' },
  { key: 'Database',   Icon: Database,   label: 'Database' },
  { key: 'Cloud',      Icon: Cloud,      label: 'Cloud' },
  { key: 'CloudCog',   Icon: CloudCog,   label: 'Cloud (cog)' },
  { key: 'Container',  Icon: Container,  label: 'Container' },
  { key: 'Boxes',      Icon: Boxes,      label: 'Boxes' },
  { key: 'Package',    Icon: Package,    label: 'Package' },

  { key: 'Monitor',    Icon: Monitor,    label: 'Monitor' },
  { key: 'Laptop',     Icon: Laptop,     label: 'Laptop' },
  { key: 'Smartphone', Icon: Smartphone, label: 'Phone' },
  { key: 'Tablet',     Icon: Tablet,     label: 'Tablet' },

  { key: 'Terminal',   Icon: Terminal,   label: 'Terminal' },
  { key: 'Code',       Icon: Code,       label: 'Code' },
  { key: 'Bug',        Icon: Bug,        label: 'Bug' },
  { key: 'Wrench',     Icon: Wrench,     label: 'Wrench' },
  { key: 'Hammer',     Icon: Hammer,     label: 'Hammer' },
  { key: 'Cog',        Icon: Cog,        label: 'Cog' },

  { key: 'Globe',      Icon: Globe,      label: 'Globe' },
  { key: 'Network',    Icon: Network,    label: 'Network' },
  { key: 'Wifi',       Icon: Wifi,       label: 'WiFi' },
  { key: 'Lock',       Icon: Lock,       label: 'Lock' },
  { key: 'Key',        Icon: Key,        label: 'Key' },
  { key: 'Shield',     Icon: Shield,     label: 'Shield' },

  { key: 'Power',      Icon: Power,      label: 'Power' },
  { key: 'Bot',        Icon: Bot,        label: 'Bot' },
  { key: 'Ghost',      Icon: Ghost,      label: 'Ghost' },
  { key: 'Rocket',     Icon: Rocket,     label: 'Rocket' },
  { key: 'Coffee',     Icon: Coffee,     label: 'Coffee' },
  { key: 'Flame',      Icon: Flame,      label: 'Flame' },
  { key: 'Zap',        Icon: Zap,        label: 'Zap' },
];

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
