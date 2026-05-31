import { createBehaviorHarness, hasSameMembers, isObject } from "./helpers.ts";

const EXPECTED_ASSERTIONS = 31;

export async function runBehaviorTests(baseUrl) {
  const { check, request, exception, result } = createBehaviorHarness(
    baseUrl,
    EXPECTED_ASSERTIONS,
  );

  try {
    const health = await request("GET", "/api/health-check");
    check("health status", health.response.status === 200, health.text);

    const teamA = await request("POST", "/api/teams", { slug: "alpha", name: "Alpha" });
    check("create team alpha", teamA.response.status === 201, teamA.text);
    check("team alpha slug", teamA.json?.slug === "alpha");

    const teamB = await request("POST", "/api/teams", { slug: "beta", name: "Beta" });
    check("create team beta", teamB.response.status === 201, teamB.text);

    const duplicateTeam = await request("POST", "/api/teams", { slug: "alpha", name: "Again" });
    check("duplicate team returns 409", duplicateTeam.response.status === 409);

    const alice = await request("POST", "/api/users", {
      username: "alice",
      teamId: teamA.json?.id,
    });
    check("create alice status", alice.response.status === 201, alice.text);
    check("alice token", typeof alice.json?.token === "string" && alice.json.token.length > 8);

    const bob = await request("POST", "/api/users", {
      username: "bob",
      teamId: teamB.json?.id,
    });
    check("create bob status", bob.response.status === 201, bob.text);

    const noAuthIssue = await request("POST", "/api/issues", {
      teamId: teamA.json?.id,
      title: "No auth",
      labels: ["api"],
    });
    check("missing auth issue returns 401", noAuthIssue.response.status === 401);

    const issueA = await request(
      "POST",
      "/api/issues",
      {
        teamId: teamA.json?.id,
        title: "API bug",
        labels: ["api", "bug"],
      },
      alice.json.token,
    );
    check("create issue A", issueA.response.status === 201, issueA.text);
    check("issue A shape", isObject(issueA.json) && issueA.json.status === "todo");

    const issueA2 = await request(
      "POST",
      "/api/issues",
      {
        teamId: teamA.json?.id,
        title: "API chore",
        labels: ["api"],
      },
      alice.json.token,
    );
    check("create issue A2", issueA2.response.status === 201, issueA2.text);

    const issueB = await request(
      "POST",
      "/api/issues",
      {
        teamId: teamB.json?.id,
        title: "Beta issue",
        labels: ["api", "bug"],
      },
      bob.json.token,
    );
    check("create issue B", issueB.response.status === 201, issueB.text);

    const teamAList = await request("GET", `/api/teams/${teamA.json?.id}/issues`);
    check("team A list status", teamAList.response.status === 200, teamAList.text);
    check(
      "team A list does not leak beta",
      hasSameMembers(
        teamAList.json?.map((issue) => issue.id),
        [issueA.json?.id, issueA2.json?.id],
      ),
    );

    const labelFilter = await request("GET", `/api/teams/${teamA.json?.id}/issues?labels=api,bug`);
    check("label filter status", labelFilter.response.status === 200, labelFilter.text);
    check(
      "label filter uses AND",
      Array.isArray(labelFilter.json) &&
        labelFilter.json.length === 1 &&
        labelFilter.json[0]?.id === issueA.json?.id,
    );

    const invalidTransition = await request(
      "PATCH",
      `/api/issues/${issueA.json?.id}`,
      { status: "done" },
      alice.json.token,
    );
    check("todo to done returns 400", invalidTransition.response.status === 400);

    const toDoing = await request(
      "PATCH",
      `/api/issues/${issueA.json?.id}`,
      { status: "doing" },
      alice.json.token,
    );
    check("todo to doing status", toDoing.response.status === 200, toDoing.text);
    check("issue now doing", toDoing.json?.status === "doing");

    const bobPatchAlpha = await request(
      "PATCH",
      `/api/issues/${issueA.json?.id}`,
      { status: "done" },
      bob.json.token,
    );
    check("other team cannot patch issue", bobPatchAlpha.response.status === 403);

    const toDone = await request(
      "PATCH",
      `/api/issues/${issueA.json?.id}`,
      { status: "done" },
      alice.json.token,
    );
    check("doing to done status", toDone.response.status === 200, toDone.text);
    check("issue now done", toDone.json?.status === "done");

    const comment1 = await request(
      "POST",
      `/api/issues/${issueA.json?.id}/comments`,
      { body: "first" },
      alice.json.token,
    );
    check("comment 1 status", comment1.response.status === 201, comment1.text);

    const comment2 = await request(
      "POST",
      `/api/issues/${issueA.json?.id}/comments`,
      { body: "second" },
      alice.json.token,
    );
    check("comment 2 status", comment2.response.status === 201, comment2.text);

    const issueWithComments = await request("GET", `/api/teams/${teamA.json?.id}/issues`);
    const updatedIssue = issueWithComments.json?.find((issue) => issue.id === issueA.json?.id);
    check(
      "comments oldest first",
      Array.isArray(updatedIssue?.comments) &&
        updatedIssue.comments[0]?.body === "first" &&
        updatedIssue.comments[1]?.body === "second",
    );

    const summary = await request("GET", `/api/teams/${teamA.json?.id}/summary`);
    check("summary status", summary.response.status === 200, summary.text);
    check("summary todo count", summary.json?.todoCount === 1);
    check("summary doing count", summary.json?.doingCount === 0);
    check("summary done count", summary.json?.doneCount === 1);
    check("summary issue ids", hasSameMembers(summary.json?.issueIds, [issueA.json?.id, issueA2.json?.id]));
  } catch (error) {
    exception(error);
  }

  return result();
}

