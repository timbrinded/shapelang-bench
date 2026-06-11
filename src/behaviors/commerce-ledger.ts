function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoString(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function bySku(products: any, sku: string) {
  return Array.isArray(products) ? products.find((product) => product.sku === sku) : null;
}

function byLineSku(order: any, sku: string) {
  return Array.isArray(order?.items) ? order.items.find((line: { sku?: string }) => line.sku === sku) : null;
}

const EXPECTED_ASSERTIONS = 64;

export async function runBehaviorTests(baseUrl: string) {
  const failures: Array<{ name: string; detail: string }> = [];
  let passed = 0;
  let total = 0;

  function check(name: string, condition: boolean, detail = "") {
    total += 1;
    if (condition) {
      passed += 1;
      return;
    }
    failures.push({ name, detail });
  }

  async function request(method: string, path: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    const init: RequestInit = { method, headers };
    if (token) headers.authorization = `Token ${token}`;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    let json = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { response, text, json };
  }

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const badUser = await request("POST", "/api/users", {});
    check("invalid user returns 400", badUser.response.status === 400);

    const ada = await request("POST", "/api/users", { username: "ada" });
    check("create ada status", ada.response.status === 201, ada.text);
    check("create ada json", isObject(ada.json));
    check("ada id string", typeof ada.json?.id === "string");
    check("ada username", ada.json?.username === "ada");
    check("ada token string", typeof ada.json?.token === "string" && ada.json.token.length > 8);
    check("ada createdAt iso", isIsoString(ada.json?.createdAt));

    const adaDuplicate = await request("POST", "/api/users", { username: "ada" });
    check("duplicate username returns 409", adaDuplicate.response.status === 409);

    const bob = await request("POST", "/api/users", { username: "bob" });
    check("create bob status", bob.response.status === 201, bob.text);
    check("bob token differs", typeof bob.json?.token === "string" && bob.json.token !== ada.json?.token);

    const badProduct = await request("POST", "/api/products", {
      sku: "bad",
      name: "Bad",
      priceCents: -1,
      stock: 1,
    });
    check("invalid product returns 400", badProduct.response.status === 400);

    const keyboard = await request("POST", "/api/products", {
      sku: "keyboard",
      name: "Keyboard",
      priceCents: 2500,
      stock: 3,
    });
    check("create keyboard status", keyboard.response.status === 201, keyboard.text);
    check("keyboard shape", keyboard.json?.sku === "keyboard" && keyboard.json?.stock === 3);
    check("keyboard createdAt iso", isIsoString(keyboard.json?.createdAt));

    const mouse = await request("POST", "/api/products", {
      sku: "mouse",
      name: "Mouse",
      priceCents: 1200,
      stock: 5,
    });
    check("create mouse status", mouse.response.status === 201, mouse.text);

    const cable = await request("POST", "/api/products", {
      sku: "cable",
      name: "Cable",
      priceCents: 300,
      stock: 1,
    });
    check("create cable status", cable.response.status === 201, cable.text);

    const duplicateSku = await request("POST", "/api/products", {
      sku: "mouse",
      name: "Mouse 2",
      priceCents: 1400,
      stock: 2,
    });
    check("duplicate sku returns 409", duplicateSku.response.status === 409);

    const noAuthOrder = await request("POST", "/api/orders", {
      items: [{ sku: "keyboard", quantity: 1 }],
    });
    check("missing auth order returns 401", noAuthOrder.response.status === 401);

    const malformedAuth = await fetch(`${baseUrl}/api/users/me/summary`, {
      headers: { authorization: ada.json?.token ?? "" },
    });
    check("malformed auth returns 401", malformedAuth.status === 401);

    const invalidOrderBody = await request("POST", "/api/orders", { items: [] }, ada.json.token);
    check("empty order returns 400", invalidOrderBody.response.status === 400);

    const missingProductOrder = await request(
      "POST",
      "/api/orders",
      { items: [{ sku: "missing", quantity: 1 }] },
      ada.json.token,
    );
    check("missing product order returns 404", missingProductOrder.response.status === 404);

    const order = await request(
      "POST",
      "/api/orders",
      {
        items: [
          { sku: "keyboard", quantity: 2 },
          { sku: "mouse", quantity: 1 },
        ],
      },
      ada.json.token,
    );
    check("create order status", order.response.status === 201, order.text);
    check("order json", isObject(order.json));
    check("order id string", typeof order.json?.id === "string");
    check("order owner", order.json?.userId === ada.json?.id);
    check("order status placed", order.json?.status === "placed");
    check("order total", order.json?.totalCents === 6200);
    check("order createdAt iso", isIsoString(order.json?.createdAt));
    check("order has two lines", Array.isArray(order.json?.items) && order.json.items.length === 2);
    check("keyboard line total", byLineSku(order.json, "keyboard")?.lineTotalCents === 5000);
    check("mouse line total", byLineSku(order.json, "mouse")?.lineTotalCents === 1200);

    const productsAfterOrder = await request("GET", "/api/products");
    check("list products status", productsAfterOrder.response.status === 200, productsAfterOrder.text);
    check("keyboard stock decremented", bySku(productsAfterOrder.json, "keyboard")?.stock === 1);
    check("mouse stock decremented", bySku(productsAfterOrder.json, "mouse")?.stock === 4);
    check("cable stock unchanged", bySku(productsAfterOrder.json, "cable")?.stock === 1);

    const lowStock = await request("GET", "/api/products?lowStockThreshold=1");
    check("low stock status", lowStock.response.status === 200, lowStock.text);
    check(
      "low stock filters keyboard and cable only",
      Array.isArray(lowStock.json) &&
        lowStock.json.length === 2 &&
        lowStock.json.some((product) => product.sku === "keyboard") &&
        lowStock.json.some((product) => product.sku === "cable"),
    );

    const overOrder = await request(
      "POST",
      "/api/orders",
      { items: [{ sku: "keyboard", quantity: 2 }] },
      ada.json.token,
    );
    check("insufficient stock returns 409", overOrder.response.status === 409);

    const productsAfterFailedOrder = await request("GET", "/api/products");
    check(
      "failed order does not change stock",
      bySku(productsAfterFailedOrder.json, "keyboard")?.stock === 1,
    );

    const getOrderAda = await request("GET", `/api/orders/${order.json?.id}`, undefined, ada.json.token);
    check("owner can get order", getOrderAda.response.status === 200, getOrderAda.text);
    check("owner get preserves nested items", byLineSku(getOrderAda.json, "mouse")?.quantity === 1);

    const getOrderBob = await request("GET", `/api/orders/${order.json?.id}`, undefined, bob.json.token);
    check("other user cannot get order", getOrderBob.response.status === 403);

    const bobOrder = await request(
      "POST",
      "/api/orders",
      { items: [{ sku: "mouse", quantity: 1 }] },
      bob.json.token,
    );
    check("bob creates own order", bobOrder.response.status === 201, bobOrder.text);
    check("bob order owner", bobOrder.json?.userId === bob.json?.id);

    const adaSummaryBeforeCancel = await request(
      "GET",
      "/api/users/me/summary",
      undefined,
      ada.json.token,
    );
    check("ada summary status", adaSummaryBeforeCancel.response.status === 200, adaSummaryBeforeCancel.text);
    check("ada active order count before cancel", adaSummaryBeforeCancel.json?.activeOrderCount === 1);
    check("ada canceled order count before cancel", adaSummaryBeforeCancel.json?.canceledOrderCount === 0);
    check("ada spent before cancel", adaSummaryBeforeCancel.json?.totalSpentCents === 6200);
    check(
      "ada open order ids before cancel",
      Array.isArray(adaSummaryBeforeCancel.json?.openOrderIds) &&
        adaSummaryBeforeCancel.json.openOrderIds.includes(order.json?.id),
    );

    const bobCancelAdaOrder = await request(
      "POST",
      `/api/orders/${order.json?.id}/cancel`,
      undefined,
      bob.json.token,
    );
    check("other user cannot cancel order", bobCancelAdaOrder.response.status === 403);

    const cancel = await request("POST", `/api/orders/${order.json?.id}/cancel`, undefined, ada.json.token);
    check("cancel status", cancel.response.status === 200, cancel.text);
    check("cancel changes status", cancel.json?.status === "canceled");
    check("cancel keeps total", cancel.json?.totalCents === 6200);

    const productsAfterCancel = await request("GET", "/api/products");
    check("keyboard stock restored", bySku(productsAfterCancel.json, "keyboard")?.stock === 3);
    check("mouse stock restored with bob order still applied", bySku(productsAfterCancel.json, "mouse")?.stock === 4);

    const cancelAgain = await request("POST", `/api/orders/${order.json?.id}/cancel`, undefined, ada.json.token);
    check("cancel twice returns 409", cancelAgain.response.status === 409);

    const adaSummaryAfterCancel = await request("GET", "/api/users/me/summary", undefined, ada.json.token);
    check("ada active order count after cancel", adaSummaryAfterCancel.json?.activeOrderCount === 0);
    check("ada canceled order count after cancel", adaSummaryAfterCancel.json?.canceledOrderCount === 1);
    check("ada spent after cancel excludes canceled", adaSummaryAfterCancel.json?.totalSpentCents === 0);
    check(
      "ada open order ids after cancel empty",
      Array.isArray(adaSummaryAfterCancel.json?.openOrderIds) &&
        adaSummaryAfterCancel.json.openOrderIds.length === 0,
    );

    const bobSummary = await request("GET", "/api/users/me/summary", undefined, bob.json.token);
    check("bob active order count", bobSummary.json?.activeOrderCount === 1);
    check("bob spent isolated from ada", bobSummary.json?.totalSpentCents === 1200);

    const missingOrder = await request("GET", "/api/orders/missing-order", undefined, ada.json.token);
    check("missing order returns 404", missingOrder.response.status === 404);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    failures.push({ name: "test runner exception", detail });
    total = Math.max(total, EXPECTED_ASSERTIONS);
  }

  return {
    assertionsPassed: passed,
    assertionsTotal: total,
    assertionPassRate: total === 0 ? 0 : passed / total,
    failures,
  };
}
