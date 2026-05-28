type Failure = { name: string; detail: string };
type JsonResponse = {
  response: Response;
  text: string;
  json: any;
};

export function createBehaviorHarness(baseUrl: string, expectedAssertions: number) {
  const failures: Failure[] = [];
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

  async function request(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<JsonResponse> {
    const headers: Record<string, string> = { ...extraHeaders };
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

  function exception(error: unknown) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    failures.push({ name: "test runner exception", detail });
    total = Math.max(total, expectedAssertions);
  }

  function result() {
    return {
      assertionsPassed: passed,
      assertionsTotal: total,
      assertionPassRate: total === 0 ? 0 : passed / total,
      failures,
    };
  }

  return { check, request, exception, result };
}

export function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIsoString(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function hasSameMembers(actual: unknown, expected: unknown[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item) => actual.includes(item))
  );
}
