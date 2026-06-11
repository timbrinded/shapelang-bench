import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 39;

function lotQuantities(availability: { lots?: { lotCode: string; quantityRemaining: number }[] } | null) {
  return availability?.lots?.map((lot) => `${lot.lotCode}:${lot.quantityRemaining}`) ?? [];
}

export async function runBehaviorTests(baseUrl: string) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const invalidItem = await request("POST", "/api/items", {
      sku: "",
      name: "bad",
      reorderPoint: 1,
    });
    check("invalid item returns 400", invalidItem.response.status === 400);

    const item = await request("POST", "/api/items", {
      sku: "WIDGET",
      name: "Widget",
      reorderPoint: 5,
    });
    check("create item status", item.response.status === 201, item.text);
    check("item shape", isObject(item.json) && item.json.sku === "WIDGET");
    check("item createdAt", isIsoString(item.json?.createdAt));

    const duplicateItem = await request("POST", "/api/items", {
      sku: "WIDGET",
      name: "Other",
      reorderPoint: 5,
    });
    check("duplicate sku returns 409", duplicateItem.response.status === 409);

    const lateLot = await request("POST", `/api/items/${item.json?.id}/lots`, {
      lotCode: "LATE",
      quantity: 10,
      expiresAt: "2026-07-01T00:00:00.000Z",
    });
    check("late lot status", lateLot.response.status === 201, lateLot.text);
    check("late lot quantity", lateLot.json?.quantityRemaining === 10);

    const earlyLot = await request("POST", `/api/items/${item.json?.id}/lots`, {
      lotCode: "EARLY",
      quantity: 4,
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    check("early lot status", earlyLot.response.status === 201, earlyLot.text);

    const duplicateLot = await request("POST", `/api/items/${item.json?.id}/lots`, {
      lotCode: "EARLY",
      quantity: 1,
      expiresAt: "2026-06-02T00:00:00.000Z",
    });
    check("duplicate lot returns 409", duplicateLot.response.status === 409);

    const before = await request("GET", `/api/items/${item.json?.id}/availability`);
    check("availability status", before.response.status === 200, before.text);
    check("availability total before", before.json?.totalAvailable === 14);
    check("availability not low before", before.json?.lowStock === false);
    check(
      "availability lots sorted before",
      hasSameMembers(lotQuantities(before.json), ["EARLY:4", "LATE:10"]) &&
        before.json.lots[0]?.lotCode === "EARLY",
    );

    const shipment = await request("POST", "/api/shipments", {
      reference: "S-1",
      lines: [{ sku: "WIDGET", quantity: 7 }],
    });
    check("shipment status", shipment.response.status === 201, shipment.text);
    check(
      "shipment shape",
      ["allocated", "created"].includes(shipment.json?.status) && shipment.json?.totalUnits === 7,
    );
    check(
      "shipment allocates earliest lot first",
      hasSameMembers(
        shipment.json?.allocations?.map((allocation: { lotCode: string; quantity: number }) => `${allocation.lotCode}:${allocation.quantity}`),
        ["EARLY:4", "LATE:3"],
      ),
    );

    const afterShipment = await request("GET", `/api/items/${item.json?.id}/availability`);
    check("availability total after shipment", afterShipment.json?.totalAvailable === 7);
    check(
      "availability quantities after shipment",
      hasSameMembers(lotQuantities(afterShipment.json), ["EARLY:0", "LATE:7"]),
    );

    const failedShipment = await request("POST", "/api/shipments", {
      reference: "S-FAILED",
      lines: [{ sku: "WIDGET", quantity: 99 }],
    });
    check("insufficient stock returns 409", failedShipment.response.status === 409);

    const afterFailed = await request("GET", `/api/items/${item.json?.id}/availability`);
    check("failed shipment does not mutate total", afterFailed.json?.totalAvailable === 7);
    check(
      "failed shipment does not mutate lots",
      hasSameMembers(lotQuantities(afterFailed.json), ["EARLY:0", "LATE:7"]),
    );

    const secondShipment = await request("POST", "/api/shipments", {
      reference: "S-2",
      lines: [{ sku: "WIDGET", quantity: 2 }],
    });
    check("second shipment status", secondShipment.response.status === 201, secondShipment.text);

    const low = await request("GET", `/api/items/${item.json?.id}/availability`);
    check("low stock total", low.json?.totalAvailable === 5);
    check("low stock flag", low.json?.lowStock === true);

    const canceled = await request("POST", `/api/shipments/${shipment.json?.id}/cancel`);
    check("cancel status", canceled.response.status === 200, canceled.text);
    check("cancel changes status", canceled.json?.status === "canceled");

    const afterCancel = await request("GET", `/api/items/${item.json?.id}/availability`);
    check("cancel restores total", afterCancel.json?.totalAvailable === 12);
    check(
      "cancel restores exact lots",
      hasSameMembers(lotQuantities(afterCancel.json), ["EARLY:4", "LATE:8"]),
    );

    const cancelAgain = await request("POST", `/api/shipments/${shipment.json?.id}/cancel`);
    check("cancel twice returns 409", cancelAgain.response.status === 409);
  } catch (error) {
    exception(error);
  }

  return result();
}
