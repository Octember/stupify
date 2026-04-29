import assert from "node:assert/strict";
import test from "node:test";
import { searchChecks } from "../src/core/checks.ts";
import { sourceId, type SemChange, type SemChangeSet } from "../src/core/types.ts";
import { counterScoutTargets } from "../src/sem/counter-scout.ts";

test("broad search checks can target non-JS source files", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "py-helper",
      entityName: "build_helper",
      entityType: "function",
      filePath: "app/workflow.py",
      changeType: "added",
      beforeContent: null,
      afterContent: "def build_helper(value):\n    return value\n",
    }]),
    searchChecks(["unnecessary_complexity"]),
    5,
  );

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.checkId, "unnecessary_complexity");
});

test("TS-specific checks do not target non-TS source files", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "py-payload",
      entityName: "UserPayload",
      entityType: "type",
      filePath: "app/workflow.py",
      changeType: "added",
      beforeContent: null,
      afterContent: "class UserPayload:\n    pass\n",
    }]),
    searchChecks(["duplicated_schema"]),
    5,
  );

  assert.equal(targets.length, 0);
});

test("TS-specific checks still target TypeScript source files", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "ts-payload",
      entityName: "UserPayload",
      entityType: "type",
      filePath: "src/user.ts",
      changeType: "added",
      beforeContent: null,
      afterContent: "type UserPayload = { id: string }\n",
    }]),
    searchChecks(["duplicated_schema"]),
    5,
  );

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.checkId, "duplicated_schema");
});

test("language overrides can disable a base search implementation", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "py-docstring",
      entityName: "parse",
      entityType: "function",
      filePath: "django/template/base.py",
      changeType: "modified",
      beforeContent: "def parse():\n    pass\n",
      afterContent: "def parse():\n    \"\"\"Parse tokens and return nodes.\"\"\"\n    pass\n",
    }]),
    searchChecks(["over_commenting"]),
    5,
  );

  assert.equal(targets.length, 0);
});

test("language counter overrides can ignore Rust test entities", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "rust-test-helper",
      entityName: "test_content_search_manager_creation",
      entityType: "function",
      filePath: "crates/codeprism-core/src/content/search.rs",
      changeType: "modified",
      beforeContent: null,
      afterContent: "#[test]\nfn test_content_search_manager_creation() {\n    let manager = ContentSearchManager::new();\n}\n",
    }]),
    searchChecks(["unnecessary_complexity"]),
    5,
  );

  assert.equal(targets.length, 0);
});

test("unnecessary complexity ignores passive shape entities", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "ts-field",
      entityName: "serviceConfigs",
      entityType: "field",
      filePath: "src/services/orchestrator-service.ts",
      changeType: "added",
      beforeContent: null,
      afterContent: "private serviceConfigs: ServiceTopicConfig[] = [];\n",
    }, {
      entityId: "ts-interface",
      entityName: "ServiceTopicConfig",
      entityType: "interface",
      filePath: "src/services/orchestrator-service.ts",
      changeType: "added",
      beforeContent: null,
      afterContent: "interface ServiceTopicConfig { serviceIndex: number }\n",
    }, {
      entityId: "ts-class",
      entityName: "OrchestratorService",
      entityType: "class",
      filePath: "src/services/orchestrator-service.ts",
      changeType: "added",
      beforeContent: null,
      afterContent: "class OrchestratorService {}\n",
    }]),
    searchChecks(["unnecessary_complexity"]),
    5,
  );

  assert.deepEqual(targets.map((target) => target.entityId), ["ts-class"]);
});

test("unnecessary complexity does not treat service as suspicious by itself", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "service-method",
      entityName: "createServiceLatencyComparison",
      entityType: "method",
      filePath: "src/dashboard-widgets.ts",
      changeType: "added",
      beforeContent: null,
      afterContent: "static createServiceLatencyComparison() { return [] }\n",
    }, {
      entityId: "orchestrator-class",
      entityName: "OrchestratorService",
      entityType: "class",
      filePath: "src/orchestrator-service.ts",
      changeType: "added",
      beforeContent: null,
      afterContent: "class OrchestratorService {}\n",
    }]),
    searchChecks(["unnecessary_complexity"]),
    5,
  );

  assert.deepEqual(targets.map((target) => target.entityId), ["orchestrator-class"]);
});

test("over commenting ignores Rust test entities", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "rust-test-comments",
      entityName: "test_change_kind_equality_and_inequality",
      entityType: "function",
      filePath: "crates/codeprism-utils/src/watcher.rs",
      changeType: "modified",
      beforeContent: "fn test_change_kind_equality_and_inequality() {}\n",
      afterContent: "#[test]\nfn test_change_kind_equality_and_inequality() {\n    // Test that different variants are not equal\n    // Test Renamed variant equality with same paths\n    // Test Display formatting\n    assert_ne!(1, 2);\n}\n",
    }]),
    searchChecks(["over_commenting"]),
    5,
  );

  assert.equal(targets.length, 0);
});

test("configured source exclusions apply across languages", () => {
  const targets = counterScoutTargets(
    changeSet([{
      entityId: "rust-helper",
      entityName: "clamp_value",
      entityType: "function",
      filePath: "target/generated/math.rs",
      changeType: "added",
      beforeContent: null,
      afterContent: "fn clamp_value(value: i32) -> i32 { value }\n",
    }]),
    searchChecks(["reinvented_utils"]),
    5,
  );

  assert.equal(targets.length, 0);
});

function changeSet(changes: readonly SemChange[]): SemChangeSet {
  return {
    id: sourceId("test"),
    label: "test",
    base: "base",
    target: "target",
    contextCwd: process.cwd(),
    cleanup: async () => undefined,
    changes,
    summary: {
      added: changes.length,
      deleted: 0,
      modified: 0,
      moved: 0,
      renamed: 0,
      fileCount: new Set(changes.map((change) => change.filePath)).size,
      total: changes.length,
    },
  };
}
