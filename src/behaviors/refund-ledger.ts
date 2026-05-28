import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 37;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const badCustomer = await request("POST", "/api/customers", { email: "" });
    check("invalid customer returns 400", badCustomer.response.status === 400);

    const customer = await request("POST", "/api/customers", { email: "ada@example.com" });
    check("create customer status", customer.response.status === 201, customer.text);
    check("customer shape", isObject(customer.json) && customer.json.email === "ada@example.com");
    check("customer createdAt", isIsoString(customer.json?.createdAt));

    const duplicateCustomer = await request("POST", "/api/customers", { email: "ada@example.com" });
    check("duplicate customer returns 409", duplicateCustomer.response.status === 409);

    const invoice = await request("POST", "/api/invoices", {
      customerId: customer.json?.id,
      number: "INV-1",
      amountCents: 1000,
    });
    check("create invoice", invoice.response.status === 201, invoice.text);
    check("invoice status open", invoice.json?.status === "open");

    const duplicateInvoice = await request("POST", "/api/invoices", {
      customerId: customer.json?.id,
      number: "INV-1",
      amountCents: 1000,
    });
    check("duplicate invoice returns 409", duplicateInvoice.response.status === 409);

    const payment1 = await request("POST", "/api/payments", {
      invoiceId: invoice.json?.id,
      amountCents: 700,
    });
    check("payment 1 status", payment1.response.status === 201, payment1.text);
    check("payment 1 amount", payment1.json?.amountCents === 700);

    const overpay = await request("POST", "/api/payments", {
      invoiceId: invoice.json?.id,
      amountCents: 400,
    });
    check("overpayment returns 409", overpay.response.status === 409);

    const payment2 = await request("POST", "/api/payments", {
      invoiceId: invoice.json?.id,
      amountCents: 300,
    });
    check("payment 2 status", payment2.response.status === 201, payment2.text);

    const ledgerPaid = await request("GET", `/api/customers/${customer.json?.id}/ledger`);
    check("ledger paid status", ledgerPaid.response.status === 200, ledgerPaid.text);
    check("ledger paid cents", ledgerPaid.json?.paidCents === 1000);
    check("ledger refunded cents before", ledgerPaid.json?.refundedCents === 0);
    check("ledger net before", ledgerPaid.json?.netCollectedCents === 1000);
    check("ledger no open invoices paid", hasSameMembers(ledgerPaid.json?.openInvoiceIds, []));

    const refund = await request(
      "POST",
      "/api/refunds",
      { invoiceId: invoice.json?.id, amountCents: 200 },
      undefined,
      { "Idempotency-Key": "refund-1" },
    );
    check("refund status", refund.response.status === 201, refund.text);
    check("refund amount", refund.json?.amountCents === 200);

    const repeatRefund = await request(
      "POST",
      "/api/refunds",
      { invoiceId: invoice.json?.id, amountCents: 200 },
      undefined,
      { "Idempotency-Key": "refund-1" },
    );
    check("repeat refund returns 200", repeatRefund.response.status === 200);
    check("repeat refund same id", repeatRefund.json?.id === refund.json?.id);

    const excessiveRefund = await request(
      "POST",
      "/api/refunds",
      { invoiceId: invoice.json?.id, amountCents: 900 },
      undefined,
      { "Idempotency-Key": "refund-2" },
    );
    check("excessive refund returns 409", excessiveRefund.response.status === 409);

    const invoice2 = await request("POST", "/api/invoices", {
      customerId: customer.json?.id,
      number: "INV-2",
      amountCents: 500,
    });
    check("create second invoice", invoice2.response.status === 201, invoice2.text);

    const ledger = await request("GET", `/api/customers/${customer.json?.id}/ledger`);
    check("ledger final paid", ledger.json?.paidCents === 1000);
    check("ledger final refunded", ledger.json?.refundedCents === 200);
    check("ledger final net", ledger.json?.netCollectedCents === 800);
    check("ledger invoice count", ledger.json?.invoiceCount === 2);
    check("ledger open invoice ids", hasSameMembers(ledger.json?.openInvoiceIds, [invoice2.json?.id]));
    check(
      "ledger entries include all documents",
      Array.isArray(ledger.json?.entries) && ledger.json.entries.length === 5,
    );
  } catch (error) {
    exception(error);
  }

  return result();
}
