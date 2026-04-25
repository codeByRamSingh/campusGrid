# CampusGrid ERP

Single-trust ERP for managing multiple colleges under one education trust.

## ✨ Dashboard Redesign - Now Live!

The Super Admin Dashboard has been completely redesigned into a modern, data-driven analytics platform featuring:

- **8-Section Modern Layout** with real-time data visualization
- **12 Specialized Analytics Components** using Recharts
- **Global Cascading Filters** (College → Course → Session)
- **Enterprise-Grade UI** built with React, TypeScript, and Tailwind CSS
- **Responsive Design** for mobile, tablet, and desktop

### Dashboard Features
- KPI Performance Metrics with trend indicators
- Revenue vs Collection dual-axis area chart
- Admissions funnel with conversion rates
- College performance stacked comparison
- Outstanding aging analysis with critical indicators
- Fee collection intensity heatmap
- 30-day attendance trend with target baseline
- Payroll exception tracking and resolution rates
- Exception trend analysis with period comparison
- Exception category breakdown
- Critical issues priority queue
- AI-powered contextual insights

The dashboard now uses live backend summary/report endpoints for trust-level KPI and aging views.

## Modules Included

- **Super Admin Dashboard** (✨ Modern Analytics - Redesigned April 2026)
- Students
  - Student Directory
  - New Admission
  - Bulk Status Operations
  - Student Timeline
  - Printables metadata (fee receipts, invoice, admit card, ID, bonafide, blank admission form)
- Finance & Accounts
  - Fee Collection
  - Miscellaneous Credits
  - Expenses
  - Ledger API with formula
- HR
  - Staff Directory
  - Add Staff with one-time invite link and password setup flow
  - Attendance
  - Leave Management
  - Payroll
- Reports & Analytics
  - Expense report
  - Dues and fines
- Admin Panel
  - Manage Colleges
  - Manage Courses and Sessions
  - Assign Roles
- Settings

## Seed Data

- Trust Name: Mother Teresa Educational Trust
- Trust Establishment Year: 2004
- Trust Registration Number: BR/2004/1787
- Super Admin:
  - Email: super_admin@campusgrid.local
  - Password: Admin@123

## Project Structure

```
campusGrid/
├── frontend/                          # React + TypeScript frontend
│   ├── src/
│   │   ├── components/dashboard/      # 12 new dashboard components
│   │   ├── modules/saas/
│   │   │   └── DashboardPage.tsx      # Redesigned dashboard (8 sections)
│   │   └── services/
│   ├── dist/                          # Production build output
│   ├── package.json
│   └── vite.config.ts
├── backend/                           # Node.js + TypeScript backend
│   ├── src/
│   ├── prisma/                        # Database schema
│   └── package.json
├── docker/
├── docker-compose.yml                 # 3 services: frontend, backend, postgres
└── README.md (this file)
```

## Documentation

- **PROJECT_NEXT_STEPS.md** - Architecture risks, roadmap, and production readiness plan
- **ARCHITECTURE_OVERVIEW.md** - System architecture and data-flow overview
- **ROLE_PERMISSION_MATRIX.md** - Staff role and permission model
- **MODULE_MATURITY.md** - Module completion status and next priorities
- **DEPLOYMENT_GUIDE.md** - Deployment, backup, restore, and release steps
- **PRODUCTION_READINESS_CHECKLIST.md** - Production rollout checklist

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Port 5173 (frontend), 4000 (backend), 5432 (database) available
- A strong production `JWT_SECRET` for non-development environments

### Run with Docker

```bash
cd campusGrid
docker compose up --build -d
```

**Access the application:**
- Frontend App: http://localhost:5173
- Backend API: http://localhost:4000/api
- Database: postgresql://localhost:5432/campusgrid

### Login
```
Email: super_admin@campusgrid.local
Password: Admin@123
```

### Stop Services
```bash
docker compose down
```

### Full Reset
```bash
docker compose down -v
docker compose up --build -d
```

## Local API Quick Checks

### 1. Login
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"super_admin@campusgrid.local","password":"Admin@123"}'
```

### 2. Health Check
```bash
curl http://localhost:4000/api/health
```

### 3. Database Status
```bash
docker compose exec db pg_isready -U postgres -d campusgrid
```

## Technology Stack

### Frontend
- React 18.3.1 with TypeScript 5.6.2 (strict mode)
- Vite 5.4.8 (build tool)
- Recharts 3.8.1 (data visualization)
- Tailwind CSS 3.4.17 (styling)
- Lucide React 1.8.0 (icons)
- Framer Motion (animations)

### Backend
- Node.js with Express
- TypeScript
- Prisma ORM
- PostgreSQL database

### Infrastructure
- Docker & Docker Compose
- PostgreSQL 16 Alpine
- Production-ready deployment

## Dashboard Component Details

### 12 Specialized Components
1. **KPIStrip** - 4-metric performance header with trends
2. **RevenueVsCollectionChart** - Dual-axis area chart (INR formatting)
3. **AdmissionsFunnelChart** - Pipeline conversion visualization
4. **CollegePerformanceChart** - Stacked bar comparison
5. **OutstandingAgingChart** - Days-past-due distribution
6. **FeeCollectionHeatmap** - Month × College intensity matrix
7. **AttendanceTrendChart** - 30-day rolling percentage
8. **PayrollExceptionTrendChart** - 6-month exception lifecycle
9. **ExceptionTrendChart** - Cumulative trend line
10. **ExceptionCategoryChart** - Donut breakdown by type
11. **CriticalIssuesList** - Priority-sorted issue queue
12. **AIInsightsPanel** - Contextual intelligence with actions

All components are fully typed, responsive, and color-coded by severity.

## Build & Deployment

### Development Build
```bash
cd frontend
npm install
npm run build
npm run preview
```

### Production Build
```bash
docker compose up --build -d
```

### Prisma Changes
If you change Prisma enums or models, make sure you also:

```bash
cd backend
npm run prisma:generate
```

and apply the required database migration before production rollout.

### Verification
- ✅ Frontend: http://localhost:5173 (HTTP 200)
- ✅ Backend: http://localhost:4000 (service responsive)
- ✅ Database: PostgreSQL accepting connections
- ✅ TypeScript: 0 compilation errors
- ✅ Build: 2908 modules transformed

## Positioning

CampusGrid is currently positioned as a single-trust ERP, not a multi-tenant SaaS platform.
- Performance optimization

## Status

✅ **Production Ready** - All features implemented, tested, and verified operational.

Dashboard Redesign Status: **COMPLETE** (April 22, 2026)

## Support

For detailed feature documentation, customization guides, and troubleshooting, see the comprehensive documentation files in the project root directory.

---

**Version:** 1.0.0  
**Last Updated:** April 22, 2026  
**Status:** Production Ready
