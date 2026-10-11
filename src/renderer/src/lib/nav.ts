export interface NavItem {
  to: string
  label: string
  icon: string
  exact?: boolean
  /** key into the badge counts computed by the layout */
  badge?: 'needsRelogin' | 'approvals' | 'runs'
  tone?: 'signal' | 'bad'
  shortcut?: string
}

export const NAV: { group?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: 'Brands', icon: 'cubby', exact: true, badge: 'needsRelogin', tone: 'bad', shortcut: 'g b' },
      { to: '/compose', label: 'Compose', icon: 'compose', shortcut: 'g c' },
      { to: '/calendar', label: 'Calendar', icon: 'calendar', shortcut: 'g k' },
      { to: '/approvals', label: 'Approvals', icon: 'approve', badge: 'approvals', tone: 'signal', shortcut: 'g a' }
    ]
  },
  {
    group: 'Library',
    items: [
      { to: '/media', label: 'Media', icon: 'image', shortcut: 'g m' },
      { to: '/flows', label: 'Flows', icon: 'flow', badge: 'runs', shortcut: 'g f' }
    ]
  },
  {
    group: 'Control',
    items: [
      { to: '/activity', label: 'Activity', icon: 'activity', shortcut: 'g l' },
      { to: '/claude', label: 'Claude', icon: 'claude', shortcut: 'g i' }
    ]
  }
]

export const NAV_FOOT: NavItem[] = [
  { to: '/recycle', label: 'Recycle bin', icon: 'recycle' },
  { to: '/settings', label: 'Settings', icon: 'settings', shortcut: 'g s' }
]
