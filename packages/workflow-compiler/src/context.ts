/**
 * State shared by the passes of one compilation. Each pass reads what earlier passes resolved
 * (manifests, ports, compiled bindings, dependencies, guards) and adds its own results.
 */
import type {
  CompileOptions,
  CompiledBinding,
  CompiledTemplate,
  JsonValue,
  SubflowSignature,
  ControlEdge,
  DataDependency,
  Guard,
  Idempotency,
  JsonSchema,
  NodeManifest,
  PortSpec,
  ToolDefinition,
  WorkerPool,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import { Diagnostics } from "./diagnostics.js";

/** A data dependency together with what the type pass needs to check it. */
export interface TypedDependency extends DataDependency {
  /** Schema of the value the binding reads, after projecting `path` (undefined = untyped). */
  sourceSchema?: JsonSchema;
  /** Where the binding sits, for diagnostics. */
  bindingPath: string;
  /** JSON pointer of the binding in the definition. */
  definitionPath: string;
  /** The producer is read inside a template/expression with no default and no coalesce. */
  bare: boolean;
}

export interface NodeInfo {
  node: WorkflowNode;
  /** Position in `definition.nodes` (for JSON pointers). */
  index: number;
  /** "" for the root scope, otherwise the container node id. */
  scope: string;
  /** Task nodes: the resolved manifest. */
  manifest?: NodeManifest;
  /** Ports could not be determined (unknown node type): references to it are not checked further. */
  unresolved: boolean;
  /** Subflow nodes: the resolved child signature. */
  subflowSignature?: SubflowSignature;
  /** Task nodes with a toolSignature rule: the resolved tool. */
  tool?: ToolDefinition;
  /** Declared data-in ports (tasks: manifest + port rules). */
  inputPorts: Map<string, PortSpec>;
  /** Accepts any additional input port with this schema (manifest `dynamicInputs`). */
  dynamicInputSchema?: JsonSchema;
  /** Data-out ports in declaration order. */
  outputs: Map<string, JsonSchema>;
  /** Control-out ports in declaration order. */
  controlOut: string[];
  /**
   * Families of control ports of which at most one fires per completion. Two guard literals of
   * this node contradict when their ports differ and one family contains both.
   */
  exclusiveFamilies: string[][];
  idempotency: Idempotency;
  pool: WorkerPool;
  /** Compiled data-in bindings, keyed by the port they feed (config bindings by `/pointer`). */
  compiled: Map<string, CompiledBinding>;
  configTemplates: Map<string, CompiledTemplate>;
  configBindings: Map<string, CompiledBinding>;
  /** Config pointers holding a FlowExpr source (`x-ui: { widget: 'code', language: 'flowexpr' }`). */
  configExpressions: Set<string>;
  /** Literal config with template and bindable fields removed. */
  literalConfig?: Record<string, JsonValue>;
  /** Data dependencies derived from this node's bindings. */
  dataIn: TypedDependency[];
  /** Incoming control edges. */
  controlIn: ControlEdge[];
  guard?: Guard;
  /** Exclusive-group index per incoming control edge id. */
  groups?: Map<string, number>;
}

/** A binding whose value must fit a declared schema; checked by the type pass. */
export interface TypeCheck {
  info: NodeInfo;
  port: string;
  compiled: CompiledBinding;
  target: JsonSchema;
  path: string;
}

export class CompileContext {
  /** Binding → declared-schema checks queued by the bindings pass for the type pass. */
  readonly typeChecks: TypeCheck[] = [];
  readonly diagnostics = new Diagnostics();
  readonly nodes: NodeInfo[] = [];
  readonly byId = new Map<string, NodeInfo>();
  /** Nodes that are never executed (notes, disabled nodes); removed before analysis. */
  readonly dropped = new Set<string>();
  /** Definition indexes excluded from analysis (second and later nodes with a duplicate id). */
  readonly excludedIndexes = new Set<number>();
  /** container id → body node ids (definition order). */
  readonly bodies = new Map<string, string[]>();
  /** Nodes whose outputs some binding reads (including container body bindings). */
  readonly readNodes = new Set<string>();
  /** Variables and secrets actually referenced (for W_*_UNUSED). */
  readonly usedVariables = new Set<string>();
  readonly usedSecrets = new Set<string>();

  constructor(
    readonly definition: WorkflowDefinition,
    readonly options: CompileOptions,
  ) {}

  node(id: string): NodeInfo | undefined {
    return this.byId.get(id);
  }

  /** Nodes that take part in execution, in definition order. */
  active(): NodeInfo[] {
    return this.nodes.filter(
      (n) => !this.dropped.has(n.node.id) && !this.excludedIndexes.has(n.index),
    );
  }
}
