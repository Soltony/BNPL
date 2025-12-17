
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { addDays } from 'date-fns';

const prisma = new PrismaClient();

const permissions = {
  superAdmin: {
    dashboard: { create: true, read: true, update: true, delete: true },
    reports: { create: true, read: true, update: true, delete: true },
    'access-control': { create: true, read: true, update: true, delete: true },
    'scoring-engine': { create: true, read: true, update: true, delete: true },
    settings: { create: true, read: true, update: true, delete: true },
    products: { create: true, read: true, update: true, delete: true },
    tax: { create: true, read: true, update: true, delete: true },
    approvals: { create: true, read: true, update: true, delete: true },
    npl: { create: true, read: true, update: true, delete: true },
    'audit-logs': { create: true, read: true, update: true, delete: true },
  },
  loanProvider: {
    dashboard: { create: false, read: true, update: false, delete: false },
    reports: { create: true, read: true, update: false, delete: false },
    'access-control': { create: false, read: false, update: false, delete: false },
    'scoring-engine': { create: false, read: true, update: true, delete: false },
    settings: { create: false, read: true, update: true, delete: false },
    products: { create: true, read: true, update: true, delete: true },
    tax: { create: false, read: true, update: false, delete: false },
    approvals: { create: false, read: false, update: false, delete: false },
    npl: { create: false, read: false, update: false, delete: false },
    'audit-logs': { create: false, read: false, update: false, delete: false },
  },
   reconciliation: {
    dashboard: { create: false, read: true, update: false, delete: false },
    reports: { create: false, read: true, update: false, delete: false },
    'access-control': { create: false, read: false, update: false, delete: false },
    'scoring-engine': { create: false, read: false, update: false, delete: false },
    settings: { create: false, read: false, update: false, delete: false },
    products: { create: false, read: false, update: false, delete: false },
    tax: { create: false, read: true, update: false, delete: false },
    approvals: { create: false, read: false, update: false, delete: false },
    npl: { create: false, read: false, update: false, delete: false },
    'audit-logs': { create: false, read: false, update: false, delete: false },
  }
};

const defaultLedgerAccounts = [
    // Assets (Receivables)
    { name: 'Principal Receivable', type: 'Receivable', category: 'Principal' },
    { name: 'Interest Receivable', type: 'Receivable', category: 'Interest' },
    { name: 'Service Fee Receivable', type: 'Receivable', category: 'ServiceFee' },
    { name: 'Penalty Receivable', type: 'Receivable', category: 'Penalty' },
    { name: 'Tax Receivable', type: 'Receivable', category: 'Tax' },
    // Cash / Received
    { name: 'Principal Received', type: 'Received', category: 'Principal' },
    { name: 'Interest Received', type: 'Received', category: 'Interest' },
    { name: 'Service Fee Received', type: 'Received', category: 'ServiceFee' },
    { name: 'Penalty Received', type: 'Received', category: 'Penalty' },
    { name: 'Tax Received', type: 'Received', category: 'Tax' },
    // Income
    { name: 'Interest Income', type: 'Income', category: 'Interest' },
    { name: 'Service Fee Income', type: 'Income', category: 'ServiceFee' },
    { name: 'Penalty Income', type: 'Income', category: 'Penalty' },
];

async function main() {
  console.log('Start seeding...');

  const desiredColumns = [
    { id: 'col-ext-0', name: 'AccountNumber', type: 'string', isIdentifier: true, options: [] },
    { id: 'col-ext-1', name: 'AccountOpeningDate', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-2', name: 'CustomerName', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-3', name: 'Country', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-4', name: 'Street', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-5', name: 'City', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-6', name: 'Nationality', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-7', name: 'Residence', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-8', name: 'NationalId', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-9', name: 'ResidenceRegion', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-10', name: 'Gender', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-11', name: 'DateOfBirth', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-12', name: 'MaritalStatus', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-13', name: 'Occupation', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-14', name: 'EmployersName', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-15', name: 'NetMonthlyIncome', type: 'number', isIdentifier: false, options: [] },
    { id: 'col-ext-16', name: 'Woreda', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-17', name: 'MotherName', type: 'string', isIdentifier: false, options: [] },
    { id: 'col-ext-18', name: 'SubCity', type: 'string', isIdentifier: false, options: [] }
  ];

  // NOTE: Instead of creating a global/sentinel provider to host a shared DataProvisioningConfig,
  // we attach a provider-scoped `ExternalCustomerInfo` config to each provider. The provider
  // create endpoints also ensure this config exists for newly created providers.

  const superAdminRole = await prisma.role.upsert({
    where: { name: 'Super Admin' },
    update: {
      permissions: JSON.stringify(permissions.superAdmin),
    },
    create: {
      name: 'Super Admin',
      permissions: JSON.stringify(permissions.superAdmin),
    },
  });

  const loanProviderRole = await prisma.role.upsert({
    where: { name: 'Loan Provider' },
    update: {
      permissions: JSON.stringify(permissions.loanProvider),
    },
    create: {
      name: 'Loan Provider',
      permissions: JSON.stringify(permissions.loanProvider),
    },
  });

  const reconciliationRole = await prisma.role.upsert({
    where: { name: 'Reconciliation' },
    update: {
      permissions: JSON.stringify(permissions.reconciliation),
    },
    create: {
      name: 'Reconciliation',
      permissions: JSON.stringify(permissions.reconciliation),
    },
  });

  const approverRole = await prisma.role.upsert({
    where: { name: 'Approver' },
    update: {
      permissions: JSON.stringify(permissions.superAdmin), // Approvers get same permissions as Super Admin
    },
    create: {
      name: 'Approver',
      permissions: JSON.stringify(permissions.superAdmin),
    },
  });


  console.log('Roles seeded.');

  // Seed User
  // Strong default password for seeded admin accounts (meets password policy)
  const hashedPassword = await bcrypt.hash('SuperAdm!2025', 10);
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { password: hashedPassword },
    create: {
      fullName: 'Super Admin',
      email: 'admin@example.com',
      phoneNumber: '0900000000',
      password: hashedPassword,
      status: 'Active',
      role: {
        connect: {
          id: superAdminRole.id,
        }
      }
    },
  });

  await prisma.user.upsert({
    where: { email: 'approver@example.com' },
    update: { password: hashedPassword },
    create: {
      fullName: 'Approver User',
      email: 'approver@example.com',
      phoneNumber: '0900000001',
      password: hashedPassword,
      status: 'Active',
      role: {
        connect: {
          id: approverRole.id,
        }
      }
    },
  });

  console.log('Admin and Approver users seeded.');

  // Seed Loan Provider and Products
  const nibBank = await prisma.loanProvider.upsert({
    where: { name: 'NIb Bank' },
    update: {},
    create: {
      name: 'NIb Bank',
      icon: 'Landmark',
      colorHex: '#fdb913',
      displayOrder: 1,
      accountNumber: '1000123456789',
      startingCapital: 1000000,
      initialBalance: 1000000,
      allowCrossProviderLoans: false,
      nplThresholdDays: 60,
    },
  });
  
  // Seed Ledger Accounts for NIb Bank
  const nibExistingAccounts = await prisma.ledgerAccount.count({ where: { providerId: nibBank.id } });
  if (nibExistingAccounts === 0) {
      await prisma.ledgerAccount.createMany({
          data: defaultLedgerAccounts.map(acc => ({
              ...acc,
              providerId: nibBank.id,
          }))
      });
      console.log('Ledger accounts for NIb Bank seeded.');
  }

  // Ensure ExternalCustomerInfo provisioning config exists for NIb Bank
  try {
    const existingExt = await prisma.dataProvisioningConfig.findFirst({ where: { providerId: nibBank.id, name: 'ExternalCustomerInfo' } });
    if (!existingExt) {
      const created = await prisma.dataProvisioningConfig.create({ data: { providerId: nibBank.id, name: 'ExternalCustomerInfo', columns: JSON.stringify(desiredColumns) } });
      console.log('Created ExternalCustomerInfo config for NIb Bank:', created.id);
    }
  } catch (e) {
    console.warn('Could not ensure ExternalCustomerInfo for NIb Bank during seed:', e);
  }

  let personalLoan = await prisma.loanProduct.findFirst({
      where: { name: 'Personal Loan', providerId: nibBank.id }
  });

  if (!personalLoan) {
      personalLoan = await prisma.loanProduct.create({
          data: {
              providerId: nibBank.id,
              name: 'Personal Loan',
              description: 'A personal loan for your everyday needs.',
              icon: 'PersonStanding',
              minLoan: 500,
              maxLoan: 50000,
              duration: 30,
              status: 'Active',
              allowConcurrentLoans: false,
              serviceFeeEnabled: true,
              serviceFee: JSON.stringify({ type: 'percentage', value: 2 }), // 2% service fee
              dailyFeeEnabled: true,
              dailyFee: JSON.stringify({ type: 'percentage', value: 0.1, calculationBase: 'principal' }), // This enables daily fee
              penaltyRulesEnabled: true,
              penaltyRules: JSON.stringify([
                { id: 'p1', fromDay: 1, toDay: 15, type: 'fixed', value: 50, frequency: 'daily' },
                { id: 'p2', fromDay: 16, toDay: null, type: 'percentageOfPrincipal', value: 0.5, frequency: 'daily' },
              ]),
              dataProvisioningEnabled: false,
          }
      });
  }
  
  const nibLoanTiers = await prisma.loanAmountTier.count({ where: { productId: personalLoan.id } });
  if (nibLoanTiers === 0) {
    await prisma.loanAmountTier.createMany({
        data: [
            { productId: personalLoan.id, fromScore: 0, toScore: 300, loanAmount: 1000 },
            { productId: personalLoan.id, fromScore: 301, toScore: 500, loanAmount: 5000 },
            { productId: personalLoan.id, fromScore: 501, toScore: 700, loanAmount: 25000 },
            { productId: personalLoan.id, fromScore: 701, toScore: 1000, loanAmount: 50000 },
        ]
    });
  }

  // Seed Second Provider: Abyssinia Bank
  const abyssiniaBank = await prisma.loanProvider.upsert({
    where: { name: 'Abyssinia Bank' },
    update: {},
    create: {
      name: 'Abyssinia Bank',
      icon: 'Building2',
      colorHex: '#8a2be2',
      displayOrder: 2,
      accountNumber: '2000987654321',
      startingCapital: 500000,
      initialBalance: 500000,
      allowCrossProviderLoans: true,
      nplThresholdDays: 90,
    },
  });

  const abbyExistingAccounts = await prisma.ledgerAccount.count({ where: { providerId: abyssiniaBank.id } });
  if (abbyExistingAccounts === 0) {
      await prisma.ledgerAccount.createMany({
          data: defaultLedgerAccounts.map(acc => ({
              ...acc,
              providerId: abyssiniaBank.id,
          }))
      });
      console.log('Ledger accounts for Abyssinia Bank seeded.');
  }

  // Ensure ExternalCustomerInfo provisioning config exists for Abyssinia Bank
  try {
    const existingExtAbby = await prisma.dataProvisioningConfig.findFirst({ where: { providerId: abyssiniaBank.id, name: 'ExternalCustomerInfo' } });
    if (!existingExtAbby) {
      const createdAbby = await prisma.dataProvisioningConfig.create({ data: { providerId: abyssiniaBank.id, name: 'ExternalCustomerInfo', columns: JSON.stringify(desiredColumns) } });
      console.log('Created ExternalCustomerInfo config for Abyssinia Bank:', createdAbby.id);
    }
  } catch (e) {
    console.warn('Could not ensure ExternalCustomerInfo for Abyssinia Bank during seed:', e);
  }

  let mortgageLoan = await prisma.loanProduct.findFirst({
      where: { name: 'Mortgage Loan', providerId: abyssiniaBank.id }
  });

  if (!mortgageLoan) {
      mortgageLoan = await prisma.loanProduct.create({
          data: {
              providerId: abyssiniaBank.id,
              name: 'Mortgage Loan',
              description: 'Loan for purchasing property.',
              icon: 'Home',
              minLoan: 100000,
              maxLoan: 2000000,
              duration: 365,
              status: 'Active',
              allowConcurrentLoans: false,
              serviceFeeEnabled: true,
              serviceFee: JSON.stringify({ type: 'fixed', value: 5000 }),
              dailyFeeEnabled: true,
              dailyFee: JSON.stringify({ type: 'percentage', value: 0.05, calculationBase: 'principal' }),
              penaltyRulesEnabled: false,
              penaltyRules: JSON.stringify([]),
              dataProvisioningEnabled: false,
          }
      });
  }

  console.log('Loan Providers and Products seeded.');

  // (Previously there was a duplicate shared-config creation path here; the shared config is created above and attached to the sentinel provider.)

  // Seed a test borrower
  const testBorrower = await prisma.borrower.upsert({
      where: { id: 'borrower-123' },
      update: {},
      create: { id: 'borrower-123' },
  });

  // Seed a Data Provisioning Config for NIb
  // First, try to find an existing config with the same name for this provider.
  let dataConfig = await prisma.dataProvisioningConfig.findFirst({
      where: { providerId: nibBank.id, name: 'Credit Score Data' },
  });

  if (!dataConfig) {
      dataConfig = await prisma.dataProvisioningConfig.create({
          data: {
              providerId: nibBank.id,
              name: 'Credit Score Data',
              columns: JSON.stringify([
                  { id: 'c1', name: 'id', type: 'string', isIdentifier: true },
                  { id: 'c2', name: 'Full Name', type: 'string', isIdentifier: false },
                  { id: 'c3', name: 'Monthly Income', type: 'number', isIdentifier: false },
                  { id: 'c4', name: 'Employment Status', type: 'string', isIdentifier: false },
              ])
          }
      });
  }

  // Add default LoanCycleConfig for personalLoan (if not exists)
  try {
    const existingCycle = await prisma.loanCycleConfig.findFirst({ where: { productId: personalLoan.id } });
    if (!existingCycle) {
      // Create a grade-based loan cycle config for the product (product-scoped)
      await prisma.loanCycleConfig.create({
        data: {
          productId: personalLoan.id,
          metric: 'TOTAL_COUNT',
          enabled: true,
          cycleRanges: JSON.stringify([
            { label: '0-1', min: 0, max: 1 },
            { label: '2-4', min: 2, max: 4 },
            { label: '5-10', min: 5, max: 10 }
          ]),
          grades: JSON.stringify([
            { label: 'A', minScore: 700, percentages: [35, 50, 80] },
            { label: 'B', minScore: 600, percentages: [30, 45, 70] },
            { label: 'C', minScore: 450, percentages: [20, 35, 60] },
            { label: 'D', minScore: 300, percentages: [10, 20, 40] }
          ])
        }
      });
    }
  } catch (e) {
    console.warn('Failed to create default loan cycle config during seed:', e);
  }


  // Seed provisioned data for the test borrower - create a small upload so seed data is tied to an upload
  const seedUpload = await prisma.dataProvisioningUpload.create({
    data: {
      configId: dataConfig.id,
      fileName: 'seed-upload',
      rowCount: 1,
      uploadedBy: 'seed',
    }
  });

  await prisma.provisionedData.upsert({
      where: { borrowerId_configId_uploadId: { borrowerId: testBorrower.id, configId: dataConfig.id, uploadId: seedUpload.id } },
      update: {
        data: JSON.stringify({
            id: 'borrower-123',
            'Full Name': 'Test Borrower',
            'Monthly Income': 15000,
            'Employment Status': 'Employed'
        }),
        uploadId: seedUpload.id
      },
      create: {
          borrowerId: testBorrower.id,
          configId: dataConfig.id,
          uploadId: seedUpload.id,
          data: JSON.stringify({
            id: 'borrower-123',
            'Full Name': 'Test Borrower',
            'Monthly Income': 15000,
            'Employment Status': 'Employed'
          })
      }
  });
  console.log('Test borrower and provisioned data seeded.');

  // Seed an existing loan for the test borrower to test repayment
  const existingLoan = await prisma.loan.findFirst({ where: { borrowerId: testBorrower.id, productId: personalLoan.id }});
  if (!existingLoan) {
    const loanAmount = 5000;
    const serviceFeePercent = 2;
    const serviceFeeAmount = loanAmount * (serviceFeePercent / 100);
    const disbursedDate = new Date();
    const dueDate = addDays(disbursedDate, 30);

    const testApplication = await prisma.loanApplication.create({
        data: {
            borrowerId: testBorrower.id,
            productId: personalLoan.id,
            loanAmount: loanAmount,
            status: 'DISBURSED'
        }
    });
    
    await prisma.loan.create({
        data: {
            borrowerId: testBorrower.id,
            productId: personalLoan.id,
            loanApplicationId: testApplication.id,
            loanAmount: loanAmount,
            serviceFee: serviceFeeAmount,
            penaltyAmount: 0,
            disbursedDate: disbursedDate,
            dueDate: dueDate,
            repaymentStatus: 'Unpaid',
            repaidAmount: 0,
        }
    });
    
    // Decrement the provider's balance
    await prisma.loanProvider.update({
      where: { id: nibBank.id },
      data: { initialBalance: { decrement: loanAmount } }
    });

    console.log(`Created test loan for ${testBorrower.id} with a service fee and daily fee.`);
  }


  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

    