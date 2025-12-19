

import { z } from 'zod';
import { startOfDay } from 'date-fns';
import type { LucideIcon } from 'lucide-react';


export interface FeeRule {
    type: 'fixed' | 'percentage';
    value: number | '';
}

export interface DailyFeeRule extends FeeRule {
    calculationBase?: 'principal' | 'compound';
}

export interface PenaltyRule {
    id: string;
    fromDay: number | '';
    toDay: number | Infinity | '' | null;
    type: 'fixed' | 'percentageOfPrincipal' | 'percentageOfCompound';
    value: number | '';
    frequency: 'daily' | 'one-time';
}

export interface DataColumn {
    id: string;
    name: string;
    type: 'string' | 'number' | 'date';
    isIdentifier: boolean;
    options?: string[];
}

export interface DataProvisioningUpload {
    id: string;
    configId: string;
    fileName: string;
    rowCount: number;
    uploadedAt: string;
    uploadedBy: string;
    status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
}

export interface DataProvisioningConfig {
    id:string;
    providerId: string;
    name: string;
    columns: DataColumn[];
    uploads?: DataProvisioningUpload[];
    status?: 'Active' | 'PENDING_APPROVAL';
}

export interface LoanAmountTier {
    id: string;
    productId: string;
    fromScore: number;
    toScore: number;
    loanAmount: number;
}

export interface LoanProvider {
  id: string;
  name: string;
  icon: string;
  products: LoanProduct[];
  dataProvisioningConfigs?: DataProvisioningConfig[];
  color?: string;
  colorHex?: string;
  displayOrder: number;
  accountNumber: string | null;
  startingCapital: number;
  initialBalance: number;
  allowCrossProviderLoans: boolean;
  nplThresholdDays: number;
  ledgerAccounts?: LedgerAccount[];
  termsAndConditions?: TermsAndConditions[];
}

export interface LoanProduct {
  id:string;
  providerId: string;
  name: string;
  description: string;
  icon: string;
  minLoan?: number;
  maxLoan?: number;
  duration?: number;
  serviceFee: FeeRule;
  dailyFee: DailyFeeRule;
  penaltyRules: PenaltyRule[];
  loanAmountTiers?: LoanAmountTier[];
  availableLimit?: number;
  status: 'Active' | 'Disabled';
  allowConcurrentLoans?: boolean;
  serviceFeeEnabled?: boolean;
  dailyFeeEnabled?: boolean;
  penaltyRulesEnabled?: boolean;
  dataProvisioningEnabled?: boolean;
  eligibilityFilter?: string | null;
  requiredDocuments: RequiredDocument[];
  tax?: number;
  dataProvisioningConfigId?: string | null;
    loanCycleConfigId?: string | null;
    loanCycleConfig?: LoanCycleConfig | null;
  eligibilityUploadId?: string | null;
  eligibilityUpload?: DataProvisioningUpload;
}

export interface LoanCycleRange {
    label: string;
    min: number;
    max: number;
}

export interface LoanCycleGrade {
    label: string;
    minScore: number;
    percentages: number[]; // Percent numbers, e.g. 35, 50
}

export interface LoanCycleConfig {
    id: string;
    productId: string;
    enabled?: boolean;
    metric: 'PAID_EARLY' | 'PAID_LATE' | 'TOTAL_COUNT' | 'PAID_ON_TIME';
    cycleRanges?: LoanCycleRange[]; // ordered ranges matching grade percentages
    grades?: LoanCycleGrade[]; // grid rows
    // legacy fallback
    cycles?: number[];
    createdAt: string;
    updatedAt: string;
}

export interface LoanApplication {
    id: string;
    borrowerId: string;
    borrowerName?: string;
    productId: string;
    product: LoanProduct;
    loanAmount: number | null;
    status: 'APPROVED' | 'DISBURSED' | 'PENDING_REVIEW' | 'NEEDS_REVISION';
    rejectionReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
    uploadedDocuments: UploadedDocument[];
}

export interface RequiredDocument {
    id: string;
    name: string;
    description: string | null;
}

export interface UploadedDocument {
    id: string;
    requiredDocumentId: string;
    requiredDocument?: RequiredDocument;
    fileName: string;
    fileType: string;
    fileContent: string;
}


export interface Payment {
  id: string;
  amount: number;
  date: Date;
  outstandingBalanceBeforePayment?: number;
}

export interface LoanDetails {
  id: string;
  borrowerId: string;
  providerName: string;
  productName: string;
  loanAmount: number;
  serviceFee: number;
  disbursedDate: Date;
  dueDate: Date;
  repaymentStatus: 'Paid' | 'Unpaid';
  repaidAmount?: number;
  payments: Payment[];
  penaltyAmount: number;
  totalRepayableAmount?: number;
  // For calculation purposes, not stored in DB
  product: LoanProduct;
  provider?: LoanProvider;
  loanApplicationId?: string;
  calculatedRepayment?: {
    total: number;
    principal: number;
    interest: number;
    penalty: number;
    serviceFee: number;
    tax: number;
  }
}

export const CheckLoanEligibilityInputSchema = z.object({
  providerId: z.string().describe("The ID of the loan provider."),
  // Add other user data fields here as needed for a real check
  // e.g., age: z.number(), monthlyIncome: z.number(), etc.
});
export type CheckLoanEligibilityInput = z.infer<typeof CheckLoanEligibilityInputSchema>;

export const CheckLoanEligibilityOutputSchema = z.object({
  isEligible: z.boolean().describe('Whether the user is eligible for a loan.'),
  suggestedLoanAmountMin: z.number().optional().describe('The minimum suggested loan amount if eligible.'),
  suggestedLoanAmountMax: z.number().optional().describe('The maximum suggested loan amount if eligible.'),
  reason: z.string().describe('The reason for eligibility or ineligibility.'),
});
export type CheckLoanEligibilityOutput = z.infer<typeof CheckLoanEligibilityOutputSchema>;


export type UserRole = 'Super Admin' | 'Admin' | 'Loan Manager' | 'Auditor' | 'Loan Provider' | 'Reconciliation' | 'Application Reviewer';
export type UserStatus = 'Active' | 'Inactive';

export interface User {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    role: UserRole;
    status: UserStatus;
    providerId?: string | null;
    merchantId?: string | null;
    providerName?: string;
    permissions: Permissions;
}

export type Permissions = {
    [key: string]: {
        create: boolean;
        read: boolean;
        update: boolean;
        delete: boolean;
    };
};

export interface Role {
    id: string;
    name: string;
    permissions: Permissions;
}

export interface TransactionProduct {
    id: string;
    name: string;
}

// Type for Scoring Engine
export interface Rule {
  id: string;
  parameterId: string;
  field: string;
  condition: string;
  value: string;
  score: number;
}

export interface ScoringParameter {
  id: string;
  providerId: string;
  name: string;
  weight: number;
  rules: Rule[];
}

export interface ScoringHistoryItem {
    id: string;
    savedAt: Date;
    parameters: string; // Stored as JSON string
    appliedProducts: { product: { name: string } }[];
}

// Type for Legacy Scoring Config page
export type GenderImpact = number;

export interface ScoringParameters {
  productIds: string[];
  weights: {
    age: { enabled: boolean; value: number };
    transactionHistoryTotal: { enabled: boolean; value: number };
    transactionHistoryByProduct: { enabled: boolean; values: Record<string, number> };
    loanHistoryCount: { enabled: boolean; value: number };
    onTimeRepayments: { enabled: boolean; value: number };
    salary: { enabled: boolean; value: number };
  };
  genderImpact: {
    enabled: boolean;
    male: GenderImpact;
    female: GenderImpact;
  };
  occupationRisk: {
    enabled: boolean;
    values: Record<string, 'Low' | 'Medium' | 'High'>;
  };
}

export interface LedgerAccount {
    id: string;
    providerId: string;
    name: string;
    type: 'Receivable' | 'Received' | 'Income';
    category: 'Principal' | 'Interest' | 'Penalty' | 'ServiceFee' | 'Tax';
    balance: number;
}


interface LedgerData {
    principal: number;
    interest: number;
    serviceFee: number;
    penalty: number;
    tax: number;
}

interface IncomeData {
    interest: number;
    serviceFee: number;
    penalty: number;
}


export interface DashboardData {
    totalLoans: number;
    totalDisbursed: number;
    dailyDisbursement: number;
    dailyRepayments: number;
    repaymentRate: number;
    atRiskLoans: number;
    totalUsers: number;
    loanDisbursementData: { name: string; amount: number }[];
    loanStatusData: { name: string; value: number }[];
    recentActivity: { id: string; customer: string; product: string; status: string; amount: number }[];
    productOverview: { name: string; provider: string; active: number; defaulted: number; total: number, defaultRate: number }[];
    initialFund: number;
    providerFund: number;
    receivables: LedgerData;
    collections: LedgerData;
    income: IncomeData;
}


export interface TermsAndConditions {
    id: string;
    providerId: string;
    content: string;
    version: number;
    isActive: boolean;
    publishedAt: Date;
}

export interface BorrowerAgreement {
    id: string;
    borrowerId: string;
    termsId: string;
    acceptedAt: Date;
}

export interface ProviderReportData {
    portfolioSummary: {
        disbursed: number;
        repaid: number;
        outstanding: number;
    };
    collectionsReport: {
        principal: number;
        interest: number;
        servicefee: number;
        penalty: number;
        total: number;
    };
    incomeStatement: {
        accrued: {
            interest: number;
            servicefee: number;
            penalty: number;
        };
        collected: {
            interest: number;
            servicefee: number;
            penalty: number;
        };
        net: number;
    };
    fundUtilization: number;
    agingReport: {
        buckets: Record<'Pass' | 'Special Mention' | 'Substandard' | 'Doubtful' | 'Loss', number>;
        totalOverdue: number;
        byBorrower?: Array<{
            borrowerId: string;
            borrowerName: string;
            buckets: Record<'Pass' | 'Special Mention' | 'Substandard' | 'Doubtful' | 'Loss', number>;
            totalOverdue: number;
        }>;
    };
}


export type LoanReportData = {
    provider: string;
    loanId: string;
    borrowerId: string;
    borrowerName: string;
    principalDisbursed: number;
    principalOutstanding: number;
    interestOutstanding: number;
    serviceFeeOutstanding: number;
    penaltyOutstanding: number;
    totalOutstanding: number;
    status: string;
    daysInArrears: number;
};

export type CollectionsReportData = {
    provider: string;
    date: string;
    principal: number;
    interest: number;
    serviceFee: number;
    penalty: number;
    tax: number;
    total: number;
};

export type IncomeReportData = {
    provider: string;
    accruedInterest: number;
    collectedInterest: number;
    accruedServiceFee: number;
    collectedServiceFee: number;
    accruedPenalty: number;
    collectedPenalty: number;
};

export interface Tax {
    id: string;
    name: string | null;
    rate: number;
    appliedTo: string; // JSON array
}
