import type { TransactionalAudit, SaleStatus, TenderMethod } from './types.js';

/** Read model of one bill for the Sale-menu reports and the Cash/Card Update screen. Money = 2-decimal strings. */
export interface DeskBillItem {
  productName: string;
  sku: string;
  quantity: string;
  returnedQuantity: string;
  lineTotal: string;
  discountAmount: string;
  taxAmount: string;
  salesman: string | null;
}

export interface DeskBill {
  id: string;
  invoiceNo: string;
  storeId: string;
  storeName: string;
  storeRegion: string | null;
  soldAt: Date;
  cashierId: string;
  customerId: string | null;
  customerName: string | null;
  status: SaleStatus;
  subtotal: string;
  itemDiscountTotal: string;
  cartDiscountAmount: string;
  taxTotal: string;
  serviceFee: string;
  otherCharges: string;
  roundingAmount: string;
  voucherAmount: string;
  grandTotal: string;
  changeDue: string;
  fbrInvoiceNo: string | null;
  orderRef: string | null;
  returnCount: number;
  payments: { method: TenderMethod; amount: string; reference: string | null }[];
  items: DeskBillItem[];
}

export interface DeskRange {
  start: Date;
  end: Date;
  storeId?: string | undefined;
  region?: string | undefined;
}

export interface DeskRefund {
  storeId: string;
  refundMethod: TenderMethod;
  refundTotal: string;
}

export interface DeskShop {
  id: string;
  code: string;
  name: string;
  region: string | null;
}

export interface DeskLine {
  head?: string;
  type?: string;
  terminal?: string;
  description?: string;
  remarks?: string;
  amount?: string;
  gtech?: string;
  settlement?: string;
  batch?: string;
}

/** One saved Daily Cash Activity sheet. */
export interface CashActivityRecord {
  id: string;
  tenantId: string;
  storeId: string;
  businessDate: string;
  openingPettyCash: string;
  receivePettyCash: string;
  totalExpense: string;
  closingPettyCash: string;
  creditCardSales: string;
  onAccountSales: string;
  cashSales: string;
  redemptionAmount: string;
  totalSales: string;
  openingCash: string;
  adjustment: string;
  totalAvailable: string;
  depositedCash: string;
  netAvailable: string;
  expenseLines: { head: string; description: string; amount: string }[];
  receiptLines: { head: string; amount: string }[];
  transferLines: { type: string; remarks: string; amount: string }[];
  terminalLines: { terminal: string; gtech: string; settlement: string; batch: string }[];
  voucherNo: string | null;
  closed: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CashActivityValues = Omit<
  CashActivityRecord,
  'id' | 'closedAt' | 'createdAt' | 'updatedAt' | 'tenantId' | 'storeId' | 'businessDate'
>;

export interface DeskUserSerial {
  id: string;
  loginId: string;
  displayName: string;
  systemRole: string;
  status: 'ACTIVE' | 'DISABLED';
  pcSerial: string | null;
}

export interface UpdateTenderRecord {
  tenantId: string;
  saleId: string;
  payments: { method: TenderMethod; amount: string; reference: string | null }[];
  customerId: string | null;
  fbrInvoiceNo: string | null;
  audit: TransactionalAudit;
}

export interface SaleDeskRepository {
  // lookups
  listShops(tenantId: string): Promise<DeskShop[]>;
  setShopRegion(tenantId: string, storeId: string, region: string | null): Promise<DeskShop | null>;
  listSalesmen(tenantId: string): Promise<string[]>;
  listTerminals(tenantId: string): Promise<string[]>;
  listExpenseHeads(tenantId: string): Promise<string[]>;
  // bills
  listBills(tenantId: string, range: DeskRange): Promise<DeskBill[]>;
  findBill(tenantId: string, saleId: string): Promise<DeskBill | null>;
  listRefunds(tenantId: string, range: DeskRange): Promise<DeskRefund[]>;
  /** Replaces the payments of a bill (and customer/FBR number) in one transaction; throws DomainError on rule breaks. */
  updateTender(input: UpdateTenderRecord): Promise<DeskBill>;
  setFbrNumbers(
    tenantId: string,
    items: { saleId: string; fbrInvoiceNo: string | null }[],
    audit: TransactionalAudit,
  ): Promise<number>;
  // cash activity
  findActivity(
    tenantId: string,
    storeId: string,
    businessDate: string,
  ): Promise<CashActivityRecord | null>;
  listActivities(
    tenantId: string,
    storeId: string,
    from: string,
    to: string,
  ): Promise<CashActivityRecord[]>;
  /** Nearest saved sheet strictly before `businessDate` (the source of the opening balances). */
  findPreviousActivity(
    tenantId: string,
    storeId: string,
    businessDate: string,
  ): Promise<CashActivityRecord | null>;
  hasClosedActivityAfter(tenantId: string, storeId: string, businessDate: string): Promise<boolean>;
  saveActivity(
    tenantId: string,
    storeId: string,
    businessDate: string,
    values: CashActivityValues,
    closedById: string | null,
    audit: TransactionalAudit,
  ): Promise<CashActivityRecord>;
  // PC serial
  listUserSerials(tenantId: string): Promise<DeskUserSerial[]>;
  setUserSerial(
    tenantId: string,
    userId: string,
    serial: string | null,
    audit: TransactionalAudit,
  ): Promise<DeskUserSerial | null>;
  customersLite(tenantId: string): Promise<{ id: string; name: string; phone: string | null }[]>;
}
