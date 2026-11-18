import assert from 'node:assert/strict';
import path from 'node:path';
import { runRepositoryEvaluation } from '../server/evaluation/eval_service.ts';
import { graphStore } from '../server/graph/graph_store.ts';
import { ensureSampleRepositoryReady } from '../server/ingestion/ingest_service.ts';
import { parseRepositoryCodebase } from '../server/parser/index.ts';
import { retrieveCodeContext } from '../server/retrieval/hybrid_retriever.ts';

async function main() {
  console.log('1. Testing Python AST parser on sample_repositories/shopflow_api...');
  const sampleRoot = path.resolve(process.cwd(), 'sample_repositories', 'shopflow_api');
  const files = [
    'auth/middleware.py',
    'controllers/order_controller.py',
    'db/session.py',
    'gateways/payment_gateway.py',
    'repositories/base_repo.py',
    'services/base_service.py',
  ];

  const parsed = await parseRepositoryCodebase(sampleRoot, files);
  assert(parsed.nodes.length >= 25, `Expected >= 25 nodes, got ${parsed.nodes.length}`);
  assert(parsed.edges.length >= 30, `Expected >= 30 edges, got ${parsed.edges.length}`);

  const uncertainEdges = parsed.edges.filter((e) => e.uncertain);
  assert(uncertainEdges.length >= 1, 'Expected dynamic getattr reflection edge to be flagged uncertain');

  const extendsEdges = parsed.edges.filter((e) => e.type === 'EXTENDS');
  assert(
    extendsEdges.some((e) => e.source.includes('UserRepository') && e.target.includes('BaseRepository')),
    'Expected UserRepository EXTENDS BaseRepository edge',
  );

  console.log('2. Testing end-to-end sample ingestion & graph store...');
  const summary = await ensureSampleRepositoryReady();
  assert.equal(summary.status, 'ready');
  assert(graphStore.hasRepository(summary.repository_id));

  console.log('3. Testing hybrid Graph-RAG retrieval for multi-hop authentication flow...');
  const authRetrieval = await retrieveCodeContext(
    summary.repository_id,
    'How does authentication reach the database?',
    { mode: 'hybrid-graph-rag', topSeeds: 5, maxHops: 2, maxNodes: 24 },
  );
  const authNames = new Set(authRetrieval.nodes.map((n) => n.name));
  assert(authNames.has('AuthMiddleware.authenticate_request'), 'Missing AuthMiddleware.authenticate_request');
  assert(authNames.has('UserService.verify_session'), 'Missing UserService.verify_session');
  assert(authNames.has('UserRepository.find_by_token'), 'Missing UserRepository.find_by_token');
  assert(authNames.has('DBSession.query'), 'Missing DBSession.query');

  console.log('4. Running Graph-RAG vs Vector-Only benchmark...');
  const evalReport = await runRepositoryEvaluation(summary.repository_id);
  assert(evalReport.summary.avg_hybrid_recall >= evalReport.summary.avg_vector_recall, 'Hybrid recall should >= vector-only');
  console.log('Evaluation summary:', JSON.stringify(evalReport.summary));
  console.log('All Graph-RAG verification tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
