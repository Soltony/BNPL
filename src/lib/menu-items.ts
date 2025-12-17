import {
  LayoutDashboard,
  Settings,
  FileText,
  ShieldCheck,
  FileCog,
  BadgeAlert,
  Landmark,
  Download,
  FolderArchive,
  BookUser,
  CheckSquare,
  Store,
} from 'lucide-react';

export const allMenuItems = [
  {
    path: '/admin',
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['Super Admin', 'Loan Manager', 'Auditor', 'Loan Provider'],
  },
  {
    path: '/admin/branch',
    label: 'Branch',
    icon: FolderArchive,
    roles: ['Super Admin', 'Loan Manager'],
  },
  {
    path: '/admin/merchants',
    label: 'Merchants',
    icon: Store,
    roles: ['Super Admin', 'Loan Manager'],
  },
  {
    path: '/admin/reports',
    label: 'Reports',
    icon: FileText,
    roles: ['Super Admin', 'Loan Manager', 'Auditor', 'Loan Provider', 'Reconciliation'],
  },
   {
    path: '/admin/approvals',
    label: 'Approvals',
    icon: CheckSquare,
    roles: ['Super Admin', 'Loan Manager'],
  },
  {
    path: '/admin/npl',
    label: 'NPL',
    icon: BadgeAlert,
    roles: ['Super Admin', 'Loan Manager', 'Auditor'],
  },
   {
    path: '/admin/access-control',
    label: 'Access Control',
    icon: ShieldCheck,
    roles: ['Super Admin'],
  },
  {
    path: '/admin/credit-score-engine',
    label: 'Scoring Engine',
    icon: FileCog,
    roles: ['Super Admin', 'Loan Manager'],
  },
  {
    path: '/admin/tax',
    label: 'Tax',
    icon: Landmark,
    roles: ['Super Admin', 'Loan Manager'],
  },
  {
    path: '/admin/settings',
    label: 'Settings',
    icon: Settings,
    roles: ['Super Admin', 'Loan Manager', 'Loan Provider'],
  },
  {
    path: '/admin/audit-logs',
    label: 'Audit Logs',
    icon: BookUser,
    roles: ['Super Admin', 'Auditor'],
  },
];
