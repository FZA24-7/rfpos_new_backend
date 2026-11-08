# POS screen (reference layout)

The POS (`apps/web/src/pages/PosPage.tsx`) follows the reference "Point of Sales" screen. Everything on it is backed by the sales API;
the totals shown are previews and the **server recomputes every amount**.

## Money order (server and screen use the same order)

1. item lines (price, item discount %, cart discount %, GST) = `grandTotal` of the lines
2. `+ serviceFee + otherCharges`
3. `- Discount voucher` (up to its balance), then `- Credit memo` (up to its balance)
4. rounding: with "Round Not Apply" cleared, the payable amount is rounded to a whole number (the server computes it)

Charges are not refundable; a sale return gives back item values only.

## Vouchers and credit memos

- `POST /api/vouchers` (right `discount.apply`) issues a `DISCOUNT` voucher or a `CREDIT_MEMO`; the code is generated if left empty.
- `GET /api/vouchers/:code` (`pos.view`), `GET /api/vouchers` (`sales.view`), `POST /api/vouchers/:code/cancel` (`discount.apply`).
- A sale carries `discountVoucherCode` and/or `creditMemoCode`. The balance is reduced inside the sale's database transaction with a
  conditional update, so a failed sale never spends a voucher and two sales can never spend the same balance.
- Codes are private to the client (tenant). A voucher may be partly used; it becomes `USED` at zero.

## Sale fields added

`orderRef`, `fbrInvoiceNo`, `creditNoteRef` (header boxes), `serviceFee`, `otherCharges`, `roundingAmount`, `voucherAmount`,
`voucherRefs`, and a `salesman` per sale line. Migration: `20261108120000_pos_extras` (additive; existing rows get zeros/nulls).

## Not connected (shown greyed out)

Post Fbr / Repost (needs an FBR POS connection), Print Airway Bill (courier), Keenu Pay Log, Alteration, Shopping Bags, Bundle.
