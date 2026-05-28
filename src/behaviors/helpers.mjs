export function createBehaviorHarness(baseUrl, expectedAssertions) {
  const failures = [];
  let passed = 0;
  let total = 0;

  function check(name, condition, detail = "") {
    total += 1;
    if (condition) {
      passed += 1;
      return;
    }
    failures.push({ name, detail });
  }

  async function request(method, path, body, token, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const init = { method, headers };
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

  function exception(error) {
    failures.push({ name: "test runner exception", detail: String(error?.stack ?? error) });
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

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIsoString(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function hasSameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((item) => actual.includes(item))
  );
}

