# LoanFlow - Advanced Micro-Credit Platform

LoanFlow is a comprehensive, multi-provider micro-credit platform built with a modern technology stack. It provides a robust solution for managing the entire loan lifecycle, from initial provider configuration and dynamic credit scoring to borrower application, automated processing, and final repayment. The platform features distinct interfaces for administrators and borrowers, a maker-checker approval workflow for critical changes, and a sophisticated Loan Cycle feature to manage credit progression.

## ✨ Key Features

*   **Admin & Borrower Interfaces**: A secure, feature-rich admin dashboard for management and a separate, simplified flow for borrowers to apply for loans.
*   **Multi-Provider & Product Management**: Administrators can create and configure multiple loan providers (e.g., different banks) and define various loan products with unique rules, fees, and interest rates.
*   **Dynamic Credit Scoring Engine**: Each provider can build their own weighted credit scoring model using a powerful rules engine. This allows them to weigh different data points (like income or employment status) to automatically determine a borrower's eligibility and maximum loan amount.
*   **Loan Cycle Progression**: A sophisticated, grade-based feature that manages a borrower's access to their full credit limit. The system encourages good repayment behavior by gradually increasing a borrower's trust and access to capital based on their performance across multiple loans. Administrators can configure the progression metric (e.g., total loans taken, on-time repayments) and the payout percentages for each cycle.
*   **End-to-End Loan Lifecycle**: Borrowers can check eligibility, apply for a loan, and receive funds. The system tracks the entire lifecycle, including disbursement, daily fee accrual, penalties, repayments, and overdue statuses.
*   **Maker-Checker (Approval) Workflow**: Critical administrative actions, such as changing product rules, provider settings, or tax configurations, are submitted for approval by a designated "Approver" role, ensuring data integrity and operational control.
*   **Automated Backend Processes**: The application includes scheduled background services for processing automated loan repayments from borrower accounts and for identifying and flagging Non-Performing Loans (NPLs) based on configurable rules.
*   **Comprehensive Reporting & Auditing**: Admins have access to a detailed, exportable reporting suite to monitor key metrics like portfolio health, collections, income, and fund utilization. All critical actions are logged for compliance and security.
*   **Role-Based Access Control (RBAC)**: The platform features a granular access control system, allowing administrators to define roles and permissions for different user types, restricting access to sensitive data and features.
*   **Buy Now, Pay Later (BNPL)**: An integrated e-commerce shop where borrowers can purchase items from registered merchants using their available credit limit.

---

## 🛠️ Technology Stack

*   **Framework**: [Next.js](https://nextjs.org/) (App Router)
*   **Language**: [TypeScript](https://www.typescriptlang.org/)
*   **UI Library**: [React](https://reactjs.org/)
*   **Styling**: [Tailwind CSS](https://tailwindcss.com/)
*   **UI Components**: [ShadCN UI](https://ui.shadcn.com/)
*   **Database ORM**: [Prisma](https://www.prisma.io/)
*   **Database**: SQL Server
*   **Authentication**: Custom session management using [jose](https://github.com/panva/jose) for JWTs
*   **Password Hashing**: [bcryptjs](https://github.com/dcodeIO/bcrypt.js)
*   **File Parsing**: [xlsx](https://github.com/SheetJS/sheetjs) for Excel data uploads

---

## 🚀 Getting Started

Follow these instructions to get the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
*   A running instance of [SQL Server](https://www.microsoft.com/en-us/sql-server/)

### 1. Installation

Clone the repository and install the project dependencies.

```bash
git clone <your-repository-url>
cd LoanFlow
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root of the project and add your SQL Server database connection string.

```env
# Example for SQL Server
DATABASE_URL="sqlserver://USER:PASSWORD@HOST:PORT;database=DATABASE_NAME;trustServerCertificate=true"
```

Replace the placeholders with your actual database credentials.

### 3. Database Setup

Run the Prisma commands to create the database schema and apply any pending migrations.

```bash
npx prisma migrate dev --name init
```

This will synchronize your database schema with the `prisma/schema.prisma` file.

### 4. Seed the Database

Run the seed script to populate your database with initial data, including default roles, users, providers, and products.

```bash
npx prisma db seed
```

#### Default Admin Credentials:
*   **Phone Number**: `0900000000`
*   **Password**: `SuperAdm!2025`

### 5. Run the Development Server

Start the Next.js development server to run the application.

```bash
npm run dev
```

The application will be available at [http://localhost:9002](http://localhost:9002).

---

## ⚙️ Background Worker

The project includes a worker script for handling scheduled tasks like automated repayments and NPL flagging.

*   **To run the NPL status update once:**
    ```bash
    npm run run:worker -- npl
    ```
*   **To start the automated repayment service (long-running process):**
    ```bash
    npm run run:worker -- repayment-service
    ```

---

## 🏗️ Project Structure

The project is organized into the following key directories:

*   **`src/app/`**: The core of the Next.js application, using the App Router.
    *   **`admin/`**: Contains all pages and components for the secure admin dashboard.
    *   **`api/`**: Backend API routes that handle data fetching, mutations, and business logic.
    *   **`(borrower)/`**: Contains pages for the borrower-facing application, such as the loan dashboard, application form, and history.
*   **`src/components/`**: Reusable React components, organized by feature (e.g., `loan`, `user`, `admin`) and UI primitives (`ui/`).
*   **`src/lib/`**: Shared utilities, libraries, and core business logic.
    *   `prisma.ts`: Prisma client instance.
    *   `session.ts`: Handles JWT-based session creation and verification.
    *   `loan-calculator.ts`: Core logic for calculating loan repayment amounts, including interest and penalties.
    *   `audit-log.ts`: Utility for creating audit trail entries for critical actions.
*   **`src/actions/`**: Server-side functions (Server Actions) that encapsulate business logic, such as `eligibility.ts` for credit scoring.
*   **`prisma/`**: Contains the database schema (`schema.prisma`) and migration files.
    *   `seed.ts`: The script for populating the database with initial data.
*   **`public/`**: Static assets like images and icons.
*   **`src/worker.ts`**: The standalone script for running background tasks.

---

## 🔄 Application Workflow

### 1. User Authentication
*   **Admin**: Admins log in through `/admin/login`, which validates credentials against the `User` table. A JWT is stored in an `httpOnly` cookie to manage the session.
*   **Middleware (`src/middleware.ts`)**: Protects all admin routes, redirecting unauthenticated users to the login page. It also enforces role-based access control (RBAC) by checking user permissions against the route they are trying to access.

### 2. Loan Eligibility & Application (Borrower)
1.  A borrower accesses the application, typically via `/loan?borrowerId=<phone_number>`.
2.  They select a `LoanProvider` and a `LoanProduct`.
3.  The `checkLoanEligibility` action is triggered, which uses the provider's configured scoring rules to calculate a credit score based on the borrower's provisioned data.
4.  The system determines the borrower's maximum loan amount for that product, considering their score and any existing outstanding loans.
5.  The borrower uses the UI to select a loan amount within their limit and submits the application.
6.  The `/api/loans` endpoint is called to create the `LoanApplication` and `Loan` records in the database, and the funds are considered disbursed.

### 3. BNPL E-commerce Flow
1.  A borrower navigates the e-commerce interface under `/shop`.
2.  They select an item and proceed to checkout.
3.  The `/api/bnpl/checkout` endpoint validates their eligibility and credit limit against the total order amount.
4.  If successful, an `Order` is created with a `PENDING_MERCHANT_CONFIRMATION` status, and a `LoanApplication` is generated.
5.  The merchant views the order in their dashboard and confirms availability.
6.  The borrower confirms delivery, which triggers the loan disbursement via `disburseLoanTx`, creating the `Loan` and finalizing the process.

### 4. Admin Management
*   Admins manage all core entities (Providers, Products, Users, Roles) through the `/admin` dashboard.
*   **Maker-Checker Workflow**: Any critical changes (e.g., updating product fees, changing provider settings) do not take effect immediately. Instead, a `PendingChange` record is created. An "Approver" role must review and approve this change via the `/admin/approvals` page.
*   Upon approval, the change is applied to the database.

### 5. Automated Processes
*   The `worker.ts` script runs background jobs.
*   **NPL Flagging**: `updateNplStatus` finds loans that are overdue beyond a provider's configured `nplThresholdDays` and flags the borrower as 'NPL'.
*   **Automated Repayments**: `processAutomatedRepayments` simulates deducting payments from a borrower's account for overdue loans.
