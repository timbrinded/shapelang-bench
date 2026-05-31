import { createBehaviorHarness, hasSameMembers, isIsoString, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 36;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const alice = await request("POST", "/api/members", { name: "alice" });
    check("create alice status", alice.response.status === 201, alice.text);
    check("alice shape", isObject(alice.json) && alice.json.name === "alice");
    check("alice token", typeof alice.json?.token === "string" && alice.json.token.length > 8);
    check("alice createdAt", isIsoString(alice.json?.createdAt));

    const duplicateAlice = await request("POST", "/api/members", { name: "alice" });
    check("duplicate member returns 409", duplicateAlice.response.status === 409);

    const bob = await request("POST", "/api/members", { name: "bob" });
    check("create bob status", bob.response.status === 201, bob.text);

    const badBook = await request("POST", "/api/books", { isbn: "", title: "Bad" });
    check("invalid book returns 400", badBook.response.status === 400);

    const book = await request("POST", "/api/books", {
      isbn: "978-1",
      title: "Systems",
    });
    check("create book status", book.response.status === 201, book.text);
    check("book isbn", book.json?.isbn === "978-1");

    const duplicateBook = await request("POST", "/api/books", {
      isbn: "978-1",
      title: "Other",
    });
    check("duplicate isbn returns 409", duplicateBook.response.status === 409);

    const copy = await request("POST", `/api/books/${book.json?.id}/copies`, {});
    check("create copy status", copy.response.status === 201, copy.text);
    check("copy references book", copy.json?.bookId === book.json?.id);

    const noAuthLoan = await request("POST", "/api/loans", { bookId: book.json?.id });
    check("missing auth loan returns 401", noAuthLoan.response.status === 401);

    const loan = await request("POST", "/api/loans", { bookId: book.json?.id }, alice.json.token);
    check("create loan status", loan.response.status === 201, loan.text);
    check("loan owner", loan.json?.memberId === alice.json?.id);
    check("loan book", loan.json?.bookId === book.json?.id);
    check("loan status", loan.json?.status === "active");

    const duplicateLoan = await request("POST", "/api/loans", { bookId: book.json?.id }, alice.json.token);
    check("duplicate active loan returns 409", duplicateLoan.response.status === 409);

    const noCopyLoan = await request("POST", "/api/loans", { bookId: book.json?.id }, bob.json.token);
    check("no available copy returns 409", noCopyLoan.response.status === 409);

    const hold = await request("POST", `/api/books/${book.json?.id}/holds`, {}, bob.json.token);
    check("create hold status", hold.response.status === 201, hold.text);
    check("hold owner", hold.json?.memberId === bob.json?.id);
    check("hold book", hold.json?.bookId === book.json?.id);

    const duplicateHold = await request("POST", `/api/books/${book.json?.id}/holds`, {}, bob.json.token);
    check("duplicate hold returns 409", duplicateHold.response.status === 409);

    const bobBefore = await request("GET", "/api/members/me/summary", undefined, bob.json.token);
    check("bob summary before status", bobBefore.response.status === 200, bobBefore.text);
    check("bob active loans before", bobBefore.json?.activeLoanCount === 0);
    check("bob hold count before", bobBefore.json?.holdCount === 1);

    const bobReturnAliceLoan = await request(
      "POST",
      `/api/loans/${loan.json?.id}/return`,
      undefined,
      bob.json.token,
    );
    check("other member cannot return loan", bobReturnAliceLoan.response.status === 403);

    const returned = await request(
      "POST",
      `/api/loans/${loan.json?.id}/return`,
      undefined,
      alice.json.token,
    );
    check("return status", returned.response.status === 200, returned.text);
    check("return changes status", returned.json?.status === "returned");

    const returnAgain = await request(
      "POST",
      `/api/loans/${loan.json?.id}/return`,
      undefined,
      alice.json.token,
    );
    check("return twice returns 409", returnAgain.response.status === 409);

    const aliceSummary = await request("GET", "/api/members/me/summary", undefined, alice.json.token);
    check("alice active loans after return", aliceSummary.json?.activeLoanCount === 0);
    check("alice returned loan count", aliceSummary.json?.returnedLoanCount === 1);

    const bobAfter = await request("GET", "/api/members/me/summary", undefined, bob.json.token);
    check("bob active loans after hold fulfilled", bobAfter.json?.activeLoanCount === 1);
    check("bob hold count after hold fulfilled", bobAfter.json?.holdCount === 0);
    check("bob active book ids", hasSameMembers(bobAfter.json?.activeBookIds, [book.json?.id]));
  } catch (error) {
    exception(error);
  }

  return result();
}

