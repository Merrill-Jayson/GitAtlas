import type { EvaluationCaseResult, EvaluationReport } from '../../src/types/graph.ts';
import { graphStore } from '../graph/graph_store.ts';
import { ensureSampleRepositoryReady, getRepositoryStatus } from '../ingestion/ingest_service.ts';
import { retrieveCodeContext } from '../retrieval/hybrid_retriever.ts';

interface BenchmarkCase {
  id: string;
  question: string;
  expectedNames: string[];
}

const SHOPFLOW_BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: 'eval-db-session',
    question: 'Which function calls the database session?',
    expectedNames: ['BaseRepository.execute_query', 'BaseRepository.execute_write', 'DBSession.query', 'DBSession.commit'],
  },
  {
    id: 'eval-inheritance',
    question: 'Which class inherits from BaseRepository?',
    expectedNames: ['BaseRepository', 'UserRepository', 'OrderRepository'],
  },
  {
    id: 'eval-auth-flow',
    question: 'How does authentication reach the database?',
    expectedNames: [
      'AuthMiddleware.authenticate_request',
      'UserService.verify_session',
      'UserRepository.find_by_token',
      'BaseRepository.execute_query',
      'DBSession.query',
    ],
  },
  {
    id: 'eval-imports-gateway',
    question: 'Which modules import PaymentGateway?',
    expectedNames: ['services.base_service', 'controllers.order_controller', 'PaymentGateway'],
  },
  {
    id: 'eval-process-refund',
    question: 'What functions call process_refund?',
    expectedNames: ['OrderService.cancel_and_refund', 'run_batch_refund', 'process_refund'],
  },
];

export async function runRepositoryEvaluation(repositoryId?: string): Promise<EvaluationReport> {
  const sample = await ensureSampleRepositoryReady();
  const targetId = repositoryId && graphStore.hasRepository(repositoryId) ? repositoryId : sample.repository_id;
  const repoSummary = getRepositoryStatus(targetId) ?? sample;

  const cases: EvaluationCaseResult[] = [];

  for (const tc of SHOPFLOW_BENCHMARK_CASES) {
    const start = performance.now();
    const [hybrid, vectorOnly] = await Promise.all([
      retrieveCodeContext(targetId, tc.question, { mode: 'hybrid-graph-rag', topSeeds: 5, maxHops: 2, maxNodes: 24 }),
      retrieveCodeContext(targetId, tc.question, { mode: 'vector-only', topSeeds: 5 }),
    ]);
    const latencyMs = Math.round(performance.now() - start);

    const hybridNames = new Set(hybrid.nodes.map((n) => n.name));
    const vectorNames = new Set(vectorOnly.nodes.map((n) => n.name));

    const hybridFound = tc.expectedNames.filter((name) => hybridNames.has(name));
    const vectorFound = tc.expectedNames.filter((name) => vectorNames.has(name));

    const hybridRecall = tc.expectedNames.length > 0 ? hybridFound.length / tc.expectedNames.length : 0;
    const vectorRecall = tc.expectedNames.length > 0 ? vectorFound.length / tc.expectedNames.length : 0;

    // Check whether retrieved hybrid nodes are actually linked in the graph store
    const validCitations = hybrid.citations.filter((c) => Boolean(graphStore.getNode(targetId, c.node_id)));
    const citationAccuracy = hybrid.citations.length > 0 ? validCitations.length / hybrid.citations.length : 1;

    cases.push({
      id: tc.id,
      question: tc.question,
      expected_nodes: tc.expectedNames,
      hybrid_recall: Number(hybridRecall.toFixed(2)),
      vector_recall: Number(vectorRecall.toFixed(2)),
      hybrid_found_nodes: hybridFound,
      vector_found_nodes: vectorFound,
      hybrid_subgraph_size: hybrid.nodes.length,
      vector_subgraph_size: vectorOnly.nodes.length,
      multi_hop_connected: hybrid.edges.length > 0 && hybridFound.length >= Math.min(2, tc.expectedNames.length),
      citation_accuracy: Number(citationAccuracy.toFixed(2)),
      latency_ms: latencyMs,
    });
  }

  const total = cases.length || 1;
  return {
    repository_id: targetId,
    repository_name: repoSummary.name,
    ran_at: new Date().toISOString(),
    summary: {
      total_cases: cases.length,
      avg_hybrid_recall: Number((cases.reduce((acc, c) => acc + c.hybrid_recall, 0) / total).toFixed(2)),
      avg_vector_recall: Number((cases.reduce((acc, c) => acc + c.vector_recall, 0) / total).toFixed(2)),
      avg_citation_accuracy: Number((cases.reduce((acc, c) => acc + c.citation_accuracy, 0) / total).toFixed(2)),
      multi_hop_connection_rate: Number(
        (cases.filter((c) => c.multi_hop_connected).length / total).toFixed(2),
      ),
    },
    cases,
  };
}
