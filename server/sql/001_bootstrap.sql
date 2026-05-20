-- Minimal bootstrap for the dashboard to function.
-- Extensible later to full accounting schema.

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";

-- Auth (minimal)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text null unique,
  password_hash text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Optional user profile fields used by the dashboard Users UI.
alter table users add column if not exists original_name text;
alter table users add column if not exists first_name text;
alter table users add column if not exists last_name text;
alter table users add column if not exists address text;
alter table users add column if not exists phone text;
alter table users add column if not exists alternate_phone text;
alter table users add column if not exists pan text;
alter table users add column if not exists aadhar text;
alter table users add column if not exists documents jsonb;

-- Soft delete support (keeps history intact)
alter table users add column if not exists deleted_at timestamptz;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists idx_sessions_token on sessions (token);
create index if not exists idx_sessions_user_id on sessions (user_id);

-- Company settings (single shared row)
create table if not exists company_settings (
  id integer primary key default 1,
  name text not null default '',
  profile_completed boolean not null default false,
  address text null,
  phone text null,
  email text null,
  state text null,
  city text null,
  pincode text null,
  gst text null,
  pan text null,
  logo_url text null,
  documents jsonb null,
  business_modules jsonb not null default '{
    "selfStudyLibrary": true,
    "coaching": true,
    "school": false,
    "books": true,
    "lockers": true,
    "billing": true,
    "accounting": true,
    "purchases": true,
    "reports": true,
    "staff": true,
    "users": true
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id = 1)
);

alter table company_settings add column if not exists business_modules jsonb not null default '{
  "selfStudyLibrary": true,
  "coaching": true,
  "school": false,
  "books": true,
  "lockers": true,
  "billing": true,
  "accounting": true,
  "purchases": true,
  "reports": true,
  "staff": true,
  "users": true
}'::jsonb;

insert into company_settings (id)
values (1)
on conflict (id) do nothing;

-- Branches: one company can operate multiple centers/locations.
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text null,
  address text null,
  phone text null,
  email text null,
  is_active boolean not null default true,
  is_default boolean not null default false,
  business_modules jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_branches_name_active
  on branches (lower(name))
  where is_active = true;

insert into branches (name, code, is_default, business_modules)
select 'Main Branch', 'MAIN', true, business_modules
from company_settings
where id = 1
  and not exists (select 1 from branches);

-- Keep only one default branch.
create unique index if not exists ux_branches_single_default
  on branches (is_default)
  where is_default = true;

-- Roles and granular permissions. Keep users.role for backward compatibility,
-- but authorization should use role permissions as the app matures.
create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permissions (
  code text primary key,
  label text not null,
  module text not null,
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table if not exists user_branch_access (
  user_id uuid not null references users(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  role_id uuid not null references roles(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

insert into roles (name, description, is_system)
values
  ('owner', 'Full access across all branches and settings', true),
  ('admin', 'Manage branch operations, billing, users, and reports', true),
  ('manager', 'Manage day-to-day branch operations', true),
  ('accountant', 'Manage billing, receipts, accounting, purchases, and reports', true),
  ('receptionist', 'Manage admissions and front-desk library operations', true),
  ('teacher', 'Manage classes and learning materials', true),
  ('library_staff', 'Manage library seats, books, lockers, and check-ins', true),
  ('user', 'Basic read access', true)
on conflict (name) do nothing;

insert into permissions (code, label, module)
values
  ('dashboard.view', 'View dashboard', 'dashboard'),
  ('students.view', 'View students', 'students'),
  ('students.create', 'Create students', 'students'),
  ('students.edit', 'Edit students', 'students'),
  ('classes.view', 'View classes', 'classes'),
  ('classes.manage', 'Manage classes and materials', 'classes'),
  ('library.view', 'View library', 'library'),
  ('library.manage', 'Manage library setup', 'library'),
  ('library.checkin', 'Manage library check-ins', 'library'),
  ('billing.view', 'View billing', 'billing'),
  ('billing.create', 'Create invoices', 'billing'),
  ('billing.edit', 'Edit invoices', 'billing'),
  ('receipts.view', 'View receipts', 'receipts'),
  ('receipts.create', 'Create receipts', 'receipts'),
  ('accounting.view', 'View accounting', 'accounting'),
  ('accounting.manage', 'Manage ledgers and expenses', 'accounting'),
  ('purchases.view', 'View purchases/assets', 'purchases'),
  ('purchases.manage', 'Manage purchases/assets', 'purchases'),
  ('reports.view', 'View reports', 'reports'),
  ('staff.view', 'View staff', 'staff'),
  ('staff.manage', 'Manage staff', 'staff'),
  ('users.view', 'View users', 'users'),
  ('users.manage', 'Manage users and branch access', 'users'),
  ('roles.manage', 'Manage roles and permissions', 'roles'),
  ('branches.view', 'View branches', 'branches'),
  ('branches.manage', 'Manage branches', 'branches'),
  ('settings.manage', 'Manage company settings', 'settings')
on conflict (code) do update set
  label = excluded.label,
  module = excluded.module;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
cross join permissions p
where r.name in ('owner', 'admin')
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
join permissions p on p.code in (
  'dashboard.view', 'students.view', 'students.create', 'students.edit',
  'classes.view', 'classes.manage', 'library.view', 'library.manage',
  'library.checkin', 'billing.view', 'billing.create', 'receipts.view',
  'receipts.create', 'reports.view', 'staff.view'
)
where r.name = 'manager'
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
join permissions p on p.code in (
  'dashboard.view', 'students.view', 'billing.view', 'billing.create',
  'billing.edit', 'receipts.view', 'receipts.create', 'accounting.view',
  'accounting.manage', 'purchases.view', 'purchases.manage', 'reports.view'
)
where r.name = 'accountant'
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
join permissions p on p.code in (
  'dashboard.view', 'students.view', 'students.create', 'students.edit',
  'library.view', 'library.checkin', 'billing.view', 'billing.create',
  'receipts.view', 'receipts.create'
)
where r.name = 'receptionist'
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
join permissions p on p.code in (
  'dashboard.view', 'students.view', 'classes.view', 'classes.manage'
)
where r.name = 'teacher'
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
join permissions p on p.code in (
  'dashboard.view', 'students.view', 'library.view', 'library.manage',
  'library.checkin'
)
where r.name = 'library_staff'
on conflict do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r
join permissions p on p.code in (
  'dashboard.view', 'students.view'
)
where r.name = 'user'
on conflict do nothing;

-- Sessions carry selected branch context after login.
alter table sessions add column if not exists branch_id uuid null references branches(id) on delete set null;
create index if not exists idx_sessions_branch_id on sessions (branch_id);

-- Grant existing users access to the default branch using their legacy role.
insert into user_branch_access (user_id, branch_id, role_id, is_active)
select u.id, b.id, r.id, true
from users u
cross join lateral (
  select id from branches order by is_default desc, created_at asc limit 1
) b
join roles r on r.name = case
  when u.role in ('owner', 'admin', 'manager', 'accountant', 'receptionist', 'teacher', 'library_staff', 'user') then u.role
  else 'user'
end
where u.deleted_at is null
on conflict (user_id, branch_id) do nothing;

-- Default credential for fresh setups
-- Login: InDev
-- Password: admin1234
insert into users (username, email, password_hash, role)
select
  'InDev',
  'indev@local',
  crypt('admin1234', gen_salt('bf')),
  'admin'
where not exists (select 1 from users limit 1);

-- Classes (minimal)
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status text not null default 'active',
  monthly_fee integer not null default 0 check (monthly_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table existed from a previous bootstrap, ensure new columns exist.
alter table classes add column if not exists short_description text;
alter table classes add column if not exists class_timing text;
alter table classes add column if not exists thumbnail_url text;
alter table classes add column if not exists banner_url text;
alter table classes add column if not exists monthly_fee integer not null default 0;

-- Safety: enforce non-negative monthly fee on existing tables
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_classes_monthly_fee_nonneg'
  ) then
    alter table classes
      add constraint chk_classes_monthly_fee_nonneg
      check (monthly_fee >= 0);
  end if;
exception
  when duplicate_object then null;
end $$;

-- Class weekly schedule (per-day timing; days can be off)
create table if not exists class_weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  -- 0=Mon ... 6=Sun
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
  is_off boolean not null default false,
  start_time time null,
  end_time time null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, day_of_week),
  check (
    (is_off and start_time is null and end_time is null)
    or
    (not is_off and start_time is not null and end_time is not null and start_time < end_time)
  )
);

create index if not exists idx_class_weekly_schedule_class_id on class_weekly_schedule (class_id);
create index if not exists idx_class_weekly_schedule_day_of_week on class_weekly_schedule (day_of_week);

create index if not exists idx_classes_status on classes (status);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  account_master_id uuid null,
  alternate_phone text null,
  aadhar text null,
  guardian_name text null,
  address text null,
  admission_type text null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table existed from a previous bootstrap, ensure new columns exist.
alter table students add column if not exists account_master_id uuid;
alter table students add column if not exists alternate_phone text;
alter table students add column if not exists aadhar text;
alter table students add column if not exists guardian_name text;
alter table students add column if not exists address text;

create index if not exists idx_students_full_name on students (full_name);
create index if not exists idx_students_phone on students (phone);
create index if not exists idx_students_account_master_id on students (account_master_id);

-- Class enrollments (students can join multiple classes)
create table if not exists class_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  start_date date not null default current_date,
  end_date date null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_class_enrollments_class_id on class_enrollments (class_id);
create index if not exists idx_class_enrollments_student_id on class_enrollments (student_id);

-- Prevent duplicate active enrollment for same student in same class
create unique index if not exists ux_class_enrollments_active
  on class_enrollments (class_id, student_id)
  where status = 'active' and end_date is null;

-- Subjects (planned; supports per-subject uploads later)
create table if not exists class_subjects (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  name text not null,
  slug text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, slug)
);

create index if not exists idx_class_subjects_class_id on class_subjects (class_id);

alter table class_subjects add column if not exists position integer not null default 0;

-- Subject topics / chapters
create table if not exists class_subject_topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references class_subjects(id) on delete cascade,
  name text not null,
  is_completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_id, name)
);

create index if not exists idx_class_subject_topics_subject_id on class_subject_topics (subject_id);

alter table class_subject_topics add column if not exists is_completed boolean not null default false;
alter table class_subject_topics add column if not exists position integer not null default 0;

-- Topic parts / subparts
create table if not exists class_topic_parts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references class_subject_topics(id) on delete cascade,
  name text not null,
  is_completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, name)
);

create index if not exists idx_class_topic_parts_topic_id on class_topic_parts (topic_id);

alter table class_topic_parts add column if not exists is_completed boolean not null default false;
alter table class_topic_parts add column if not exists position integer not null default 0;

-- Subject materials (store external links + metadata, eg. PDF reference links)
create table if not exists class_subject_materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references class_subjects(id) on delete cascade,
  title text not null,
  description text null,
  url text not null,
  thumbnail_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_class_subject_materials_subject_id on class_subject_materials (subject_id);

-- Documents (planned; stores metadata for anything uploaded under Uploads/)
create table if not exists class_documents (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid null references class_subjects(id) on delete set null,
  title text not null,
  file_path text not null,
  mime_type text null,
  size_bytes bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_class_documents_class_id on class_documents (class_id);
create index if not exists idx_class_documents_subject_id on class_documents (subject_id);

-- Account master (minimal party/sub-ledger master)
create table if not exists account_master (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid null,
  name text not null,
  phone text null,
  email text null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_account_master_entity on account_master (entity_type, entity_id);
create unique index if not exists ux_account_master_entity on account_master (entity_type, entity_id)
  where entity_id is not null;

-- FK: students.account_master_id -> account_master.id (safe for re-runs)
do $$
begin
  alter table students
    add constraint fk_students_account_master
    foreign key (account_master_id)
    references account_master(id)
    on delete set null;
exception
  when duplicate_object or duplicate_table then null;
end $$;

-- Library seats (minimal)
create table if not exists library_seats (
  id uuid primary key default gen_random_uuid(),
  seat_number text not null unique,
  hall text null,
  hall_id uuid null,
  seat_type_id uuid null,
  status text not null default 'available',
  occupant_student_id uuid null references students(id) on delete set null,
  occupied_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table existed from a previous bootstrap, ensure new columns exist.
alter table library_seats add column if not exists hall text;
alter table library_seats add column if not exists hall_id uuid;
alter table library_seats add column if not exists seat_type_id uuid;
alter table library_seats add column if not exists occupant_student_id uuid;
alter table library_seats add column if not exists occupied_until timestamptz;

create index if not exists idx_library_seats_status on library_seats (status);
create index if not exists idx_library_seats_hall_id on library_seats (hall_id);
create index if not exists idx_library_seats_seat_type_id on library_seats (seat_type_id);

-- Billing (minimal)
create table if not exists billing_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  invoice_date date not null,
  -- First day of invoice month; used to enforce one-invoice-per-month per student
  billing_month date generated always as (make_date(extract(year from invoice_date)::int, extract(month from invoice_date)::int, 1)) stored,
  student_id uuid null references students(id) on delete set null,
  customer_name text not null,
  customer_mobile text null,
  billing_category text not null default 'general',
  period_start date null,
  period_end date null,
  gst_registered boolean not null default true,
  subtotal_amount numeric(12,2) not null default 0,
  gst_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  status text not null default 'issued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table existed from a previous bootstrap, ensure new columns exist.
alter table billing_invoices add column if not exists billing_category text not null default 'general';
alter table billing_invoices add column if not exists period_start date;
alter table billing_invoices add column if not exists period_end date;

create index if not exists idx_billing_invoices_invoice_date on billing_invoices (invoice_date);
create index if not exists idx_billing_invoices_student_id on billing_invoices (student_id);

-- Drop old constraint: it blocks legit non-calendar periods (library cycles) and class prepay.
drop index if exists ux_billing_invoices_student_month;

-- Enforce: only one LIBRARY-cycle invoice per student per billing period
create unique index if not exists ux_billing_invoices_student_library_period
  on billing_invoices (student_id, period_start, period_end)
  where student_id is not null
    and billing_category = 'library'
    and status <> 'void'
    and period_start is not null
    and period_end is not null;

-- If the table existed from a previous bootstrap, ensure new columns exist.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_invoices'
      and column_name = 'billing_month'
  ) then
    alter table billing_invoices
      add column billing_month date generated always as (
        make_date(extract(year from invoice_date)::int, extract(month from invoice_date)::int, 1)
      ) stored;
  end if;
exception
  when duplicate_column then null;
end $$;

-- Ensure any old calendar-month uniqueness index is removed.
drop index if exists ux_billing_invoices_student_month;

create table if not exists billing_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references billing_invoices(id) on delete cascade,
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_invoice_items_invoice_id on billing_invoice_items (invoice_id);

-- Receipts (payment collection) — minimal Indian-style Receipt voucher
create sequence if not exists receipt_no_seq;

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  receipt_date date not null,
  student_id uuid not null references students(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null,
  reference text null,
  narration text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safety for re-runs
alter table receipts add column if not exists reference text;
alter table receipts add column if not exists narration text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_receipts_payment_mode'
  ) then
    alter table receipts
      add constraint chk_receipts_payment_mode
      check (payment_mode in ('cash', 'bank', 'upi', 'card', 'other'));
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_receipts_student_id on receipts (student_id);
create index if not exists idx_receipts_receipt_date on receipts (receipt_date);

-- Accounting (double-entry) — minimal ledger system (Indian style)
create table if not exists accounting_ledgers (
  code text primary key,
  name text not null,
  nature text not null check (nature in ('asset', 'liability', 'income', 'expense')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounting_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_type text not null,
  voucher_no text not null,
  voucher_date date not null,
  party_student_id uuid null references students(id) on delete set null,
  party_name text null,
  narration text null,
  source_type text not null,
  source_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists idx_accounting_vouchers_voucher_date on accounting_vouchers (voucher_date);
create index if not exists idx_accounting_vouchers_party_student_id on accounting_vouchers (party_student_id);
create index if not exists idx_accounting_vouchers_party_student_id_voucher_date on accounting_vouchers (party_student_id, voucher_date);

create table if not exists accounting_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting_vouchers(id) on delete cascade,
  ledger_code text not null references accounting_ledgers(code) on delete restrict,
  debit numeric(12,2) not null default 0 check (debit >= 0),
  credit numeric(12,2) not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),
  check ((debit > 0 and credit = 0) or (debit = 0 and credit > 0))
);

create index if not exists idx_accounting_voucher_lines_voucher_id on accounting_voucher_lines (voucher_id);
create index if not exists idx_accounting_voucher_lines_ledger_code on accounting_voucher_lines (ledger_code);
create index if not exists idx_accounting_voucher_lines_ledger_code_voucher_id on accounting_voucher_lines (ledger_code, voucher_id);

-- Seed core ledgers
insert into accounting_ledgers (code, name, nature)
values
  ('DEBTORS_CTRL', 'Sundry Debtors (Control)', 'asset'),
  ('CREDITORS_CTRL', 'Sundry Creditors (Control)', 'liability'),
  ('LOAN_PAYABLE', 'Loan Payable', 'liability'),
  ('CASH', 'Cash', 'asset'),
  ('BANK', 'Bank', 'asset'),
  ('UPI', 'UPI', 'asset'),
  ('CARD', 'Card', 'asset'),
  ('FIXED_ASSETS', 'Fixed Assets', 'asset'),
  ('SALES', 'Sales', 'income'),
  ('PURCHASES', 'Purchases', 'expense'),
  ('INPUT_GST', 'Input GST (ITC)', 'asset'),
  ('INPUT_CGST', 'Input CGST (ITC)', 'asset'),
  ('INPUT_SGST', 'Input SGST (ITC)', 'asset'),
  ('INPUT_IGST', 'Input IGST (ITC)', 'asset'),
  ('OUTPUT_GST', 'Output GST', 'liability'),
  ('OUTPUT_CGST', 'Output CGST', 'liability'),
  ('OUTPUT_SGST', 'Output SGST', 'liability'),
  ('OUTPUT_IGST', 'Output IGST', 'liability'),
  ('TDS_PAYABLE', 'TDS Payable', 'liability'),
  ('EXPENSE_MISC', 'Expenses (Misc)', 'expense'),
  ('EXP_ELECTRICITY', 'Electricity Expense', 'expense'),
  ('EXP_WIFI', 'WiFi/Internet Expense', 'expense'),
  ('EXP_MAINTENANCE', 'Maintenance Expense', 'expense'),
  ('EXP_SALARIES', 'Salaries & Wages', 'expense')
on conflict (code) do nothing;

-- Staff (employees/contractors) — can be linked to a login user or standalone
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references users(id) on delete set null,
  display_name text not null,
  designation text null,
  phone text null,
  email text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_staff_display_name on staff (display_name);

-- Expense records with bill attachments (posts to accounting vouchers)
create sequence if not exists expense_no_seq;

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text not null,
  expense_date date not null,
  payee_name text null,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null check (payment_mode in ('cash', 'bank', 'upi', 'card', 'other')),
  ledger_code text not null references accounting_ledgers(code) on delete restrict,
  reference text null,
  narration text null,
  documents jsonb null,
  created_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_expense_date on expenses (expense_date);
create index if not exists idx_expenses_created_at on expenses (created_at);

-- Purchases (asset purchases with bill attachments)
create sequence if not exists purchase_no_seq;

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null,
  purchase_date date not null,
  vendor_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_mode text not null,
  liability_ledger_code text null,
  reference text null,
  narration text null,
  documents jsonb null,
  created_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Support asset purchases bought on credit/loan.
alter table purchases add column if not exists liability_ledger_code text null;
alter table purchases drop constraint if exists purchases_payment_mode_check;
alter table purchases
  add constraint purchases_payment_mode_check
  check (payment_mode in ('cash', 'bank', 'upi', 'card', 'other', 'credit'));

create index if not exists idx_purchases_purchase_date on purchases (purchase_date);
create index if not exists idx_purchases_created_at on purchases (created_at);

-- Voucher numbering for manual vouchers (expenses/payments/journals later)
create sequence if not exists accounting_voucher_no_seq;

-- Backfill vouchers for invoices/receipts (idempotent)
insert into accounting_vouchers (voucher_type, voucher_no, voucher_date, party_student_id, party_name, narration, source_type, source_id)
select
  'Sales',
  i.invoice_no,
  i.invoice_date,
  i.student_id,
  i.customer_name,
  (upper(i.billing_category) || ' Invoice'),
  'invoice',
  i.id
from billing_invoices i
where i.status <> 'void'
on conflict (source_type, source_id)
do update set
  voucher_no = excluded.voucher_no,
  voucher_date = excluded.voucher_date,
  party_student_id = excluded.party_student_id,
  party_name = excluded.party_name,
  narration = excluded.narration,
  updated_at = now();

insert into accounting_vouchers (voucher_type, voucher_no, voucher_date, party_student_id, party_name, narration, source_type, source_id)
select
  'Receipt',
  r.receipt_no,
  r.receipt_date,
  r.student_id,
  s.full_name,
  coalesce(nullif(r.narration, ''), 'Receipt'),
  'receipt',
  r.id
from receipts r
join students s on s.id = r.student_id
on conflict (source_type, source_id)
do update set
  voucher_no = excluded.voucher_no,
  voucher_date = excluded.voucher_date,
  party_student_id = excluded.party_student_id,
  party_name = excluded.party_name,
  narration = excluded.narration,
  updated_at = now();

-- Rebuild derived lines for invoice/receipt vouchers (safe and deterministic)
delete from accounting_voucher_lines l
using accounting_vouchers v
where l.voucher_id = v.id
  and v.source_type in ('invoice', 'receipt');

-- Invoice postings:
-- Dr Debtors Control (total)
-- Cr Sales (subtotal)
-- Cr Output GST (gst) when gst > 0
insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
select v.id, 'DEBTORS_CTRL', i.total_amount, 0
from accounting_vouchers v
join billing_invoices i on v.source_id = i.id
where v.source_type = 'invoice'
  and i.status <> 'void'
  and i.total_amount > 0;

insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
select v.id, 'SALES', 0, i.subtotal_amount
from accounting_vouchers v
join billing_invoices i on v.source_id = i.id
where v.source_type = 'invoice'
  and i.status <> 'void'
  and i.subtotal_amount > 0;

insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
select v.id, 'OUTPUT_GST', 0, i.gst_amount
from accounting_vouchers v
join billing_invoices i on v.source_id = i.id
where v.source_type = 'invoice'
  and i.status <> 'void'
  and i.gst_amount > 0;

-- Receipt postings:
-- Dr Cash/Bank/UPI/Card depending on payment_mode
-- Cr Debtors Control
insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
select
  v.id,
  case r.payment_mode
    when 'cash' then 'CASH'
    when 'bank' then 'BANK'
    when 'upi' then 'UPI'
    when 'card' then 'CARD'
    else 'BANK'
  end as ledger_code,
  r.amount,
  0
from accounting_vouchers v
join receipts r on v.source_id = r.id
where v.source_type = 'receipt'
  and r.amount > 0;

insert into accounting_voucher_lines (voucher_id, ledger_code, debit, credit)
select v.id, 'DEBTORS_CTRL', 0, r.amount
from accounting_vouchers v
join receipts r on v.source_id = r.id
where v.source_type = 'receipt'
  and r.amount > 0;

-- Library shifts (minimal)
create table if not exists library_shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_time time not null,
  end_time time not null,
  monthly_fee integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_shifts_start_time on library_shifts (start_time);

-- Library halls (minimal)
create table if not exists library_halls (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_halls_name on library_halls (name);

-- Seat types (e.g. General / Executive)
create table if not exists library_seat_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- FK: library_seats.seat_type_id -> library_seat_types.id (safe for re-runs)
do $$
begin
  alter table library_seats
    add constraint fk_library_seats_seat_type_id
    foreign key (seat_type_id)
    references library_seat_types(id)
    on delete set null;
exception
  when duplicate_object or duplicate_table then null;
end $$;

-- Shift pricing per seat type
create table if not exists library_shift_pricing (
  shift_id uuid not null references library_shifts(id) on delete cascade,
  seat_type_id uuid not null references library_seat_types(id) on delete cascade,
  monthly_fee integer not null check (monthly_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shift_id, seat_type_id)
);

create index if not exists idx_library_shift_pricing_shift_id on library_shift_pricing (shift_id);
create index if not exists idx_library_shift_pricing_seat_type_id on library_shift_pricing (seat_type_id);

-- Library memberships (admissions) — may optionally reserve a specific seat.
create table if not exists library_memberships (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  shift_id uuid not null references library_shifts(id) on delete restrict,
  seat_type_id uuid not null references library_seat_types(id) on delete restrict,
  start_date date not null default current_date,
  end_date date null,
  status text not null default 'active',
  reserved_seat_id uuid null references library_seats(id) on delete set null,
  reserved_fee integer null check (reserved_fee is null or reserved_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_memberships_student_id on library_memberships (student_id);
create index if not exists idx_library_memberships_shift_id on library_memberships (shift_id);
create index if not exists idx_library_memberships_seat_type_id on library_memberships (seat_type_id);
create index if not exists idx_library_memberships_reserved_seat_id on library_memberships (reserved_seat_id);

-- Seat usage (check-in) with DB-level protection against overlapping usage.
create table if not exists library_checkins (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references library_memberships(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  shift_id uuid not null references library_shifts(id) on delete restrict,
  seat_id uuid not null references library_seats(id) on delete restrict,
  start_at timestamptz not null default now(),
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_checkins_seat_id on library_checkins (seat_id);
create index if not exists idx_library_checkins_student_id on library_checkins (student_id);
create index if not exists idx_library_checkins_shift_id on library_checkins (shift_id);
create index if not exists idx_library_checkins_membership_id on library_checkins (membership_id);

-- Prevent two check-ins overlapping for the same seat.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'ex_library_checkins_seat_overlap'
  ) then
    null;
  else
    execute 'drop index if exists ex_library_checkins_seat_overlap';
    alter table library_checkins
      add constraint ex_library_checkins_seat_overlap
      exclude using gist (
        seat_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      );
  end if;
exception
  when duplicate_object then null;
end $$;

-- Prevent a student from being checked into two seats at the same time.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'ex_library_checkins_student_overlap'
  ) then
    null;
  else
    execute 'drop index if exists ex_library_checkins_student_overlap';
    alter table library_checkins
      add constraint ex_library_checkins_student_overlap
      exclude using gist (
        student_id with =,
        tstzrange(start_at, end_at, '[)') with &&
      );
  end if;
exception
  when duplicate_object then null;
end $$;

-- FK: library_seats.hall_id -> library_halls.id (safe for re-runs)
do $$
begin
  alter table library_seats
    add constraint fk_library_seats_hall_id
    foreign key (hall_id)
    references library_halls(id)
    on delete set null;
exception
  when duplicate_object then null;
end $$;

-- Backfill from legacy text column `hall` into `library_halls` + `library_seats.hall_id`
insert into library_halls (name)
select distinct trim(hall)
from library_seats
where hall is not null and trim(hall) <> ''
on conflict (name) do nothing;

update library_seats s
set hall_id = h.id,
    updated_at = now()
from library_halls h
where s.hall_id is null
  and s.hall is not null
  and trim(s.hall) <> ''
  and trim(s.hall) = h.name;

-- Library lockers (minimal)
-- Assumptions:
-- - Lockers are numbered 1..total_lockers
-- - One active locker per student, and one active student per locker

create table if not exists library_locker_settings (
  id uuid primary key default gen_random_uuid(),
  total_lockers integer not null default 0 check (total_lockers >= 0),
  monthly_fee integer not null default 0 check (monthly_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure a single settings row exists (safe for re-runs)
insert into library_locker_settings (total_lockers, monthly_fee)
select 0, 0
where not exists (select 1 from library_locker_settings);

create table if not exists library_locker_assignments (
  id uuid primary key default gen_random_uuid(),
  locker_number integer not null check (locker_number > 0),
  student_id uuid not null references students(id) on delete cascade,
  start_date date not null default current_date,
  end_date date null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table library_locker_assignments add column if not exists locker_number integer;
alter table library_locker_assignments add column if not exists student_id uuid;
alter table library_locker_assignments add column if not exists start_date date;
alter table library_locker_assignments add column if not exists end_date date;
alter table library_locker_assignments add column if not exists status text;

create index if not exists idx_library_locker_assignments_student_id on library_locker_assignments (student_id);
create index if not exists idx_library_locker_assignments_locker_number on library_locker_assignments (locker_number);
create index if not exists idx_library_locker_assignments_status on library_locker_assignments (status);

-- One active locker per student (end_date null) and one active student per locker.
create unique index if not exists ux_library_locker_assignments_active_student
  on library_locker_assignments (student_id)
  where status = 'active' and end_date is null;

create unique index if not exists ux_library_locker_assignments_active_locker
  on library_locker_assignments (locker_number)
  where status = 'active' and end_date is null;

-- Library books (minimal)
-- Goals:
-- - Manage book sections (Story, Academic, etc.)
-- - Each book has a unique number
-- - Track issuing/returning books to students (one active issue per book)

create table if not exists library_book_sections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists library_books (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references library_book_sections(id) on delete restrict,
  title text not null,
  unique_number text not null unique,
  thumbnail_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table library_books add column if not exists thumbnail_url text;

create index if not exists idx_library_books_section_id on library_books (section_id);
create index if not exists idx_library_books_unique_number on library_books (unique_number);

create table if not exists library_book_issues (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references library_books(id) on delete restrict,
  student_id uuid not null references students(id) on delete cascade,
  issued_date date not null default current_date,
  due_date date null,
  returned_date date null,
  status text not null default 'issued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_book_issues_book_id on library_book_issues (book_id);
create index if not exists idx_library_book_issues_student_id on library_book_issues (student_id);
create index if not exists idx_library_book_issues_status on library_book_issues (status);

-- Only one active (not returned) issue per book.
create unique index if not exists ux_library_book_issues_active_book
  on library_book_issues (book_id)
  where status = 'issued' and returned_date is null;

-- Branch scope for operational records. Existing records are backfilled to
-- the default branch so old installs keep working after upgrade.
alter table account_master add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table students add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table classes add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_halls add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_seat_types add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_seats add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_shifts add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_locker_settings add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_book_sections add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table library_books add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table billing_invoices add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table receipts add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table accounting_vouchers add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table expenses add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table purchases add column if not exists branch_id uuid null references branches(id) on delete set null;
alter table staff add column if not exists branch_id uuid null references branches(id) on delete set null;

do $$
declare
  default_branch uuid;
begin
  select id into default_branch
  from branches
  order by is_default desc, created_at asc
  limit 1;

  if default_branch is not null then
    update account_master set branch_id = default_branch where branch_id is null;
    update students set branch_id = default_branch where branch_id is null;
    update classes set branch_id = default_branch where branch_id is null;
    update library_halls set branch_id = default_branch where branch_id is null;
    update library_seat_types set branch_id = default_branch where branch_id is null;
    update library_seats set branch_id = default_branch where branch_id is null;
    update library_shifts set branch_id = default_branch where branch_id is null;
    update library_locker_settings set branch_id = default_branch where branch_id is null;
    update library_book_sections set branch_id = default_branch where branch_id is null;
    update library_books set branch_id = default_branch where branch_id is null;
    update billing_invoices set branch_id = default_branch where branch_id is null;
    update receipts set branch_id = default_branch where branch_id is null;
    update accounting_vouchers set branch_id = default_branch where branch_id is null;
    update expenses set branch_id = default_branch where branch_id is null;
    update purchases set branch_id = default_branch where branch_id is null;
    update staff set branch_id = default_branch where branch_id is null;
  end if;
end $$;

create index if not exists idx_students_branch_id on students (branch_id);
create index if not exists idx_classes_branch_id on classes (branch_id);
create index if not exists idx_library_seats_branch_id on library_seats (branch_id);
create index if not exists idx_library_shifts_branch_id on library_shifts (branch_id);
create index if not exists idx_billing_invoices_branch_id on billing_invoices (branch_id);
create index if not exists idx_receipts_branch_id on receipts (branch_id);
create index if not exists idx_accounting_vouchers_branch_id on accounting_vouchers (branch_id);
create index if not exists idx_expenses_branch_id on expenses (branch_id);
create index if not exists idx_purchases_branch_id on purchases (branch_id);
create index if not exists idx_staff_branch_id on staff (branch_id);
