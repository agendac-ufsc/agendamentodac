import express from 'express';
import app from './api/trpc.js';
import request from 'supertest';

const server = express();
server.use(app);

async function runTest() {
  console.log('--- Iniciando Teste de API tRPC ---');
  try {
    // Tenta chamar o procedimento auth.me que estava falhando nos logs da Vercel
    const response = await request(server)
      .get('/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D')
      .set('Accept', 'application/json');
    
    console.log('Status Code:', response.status);
    console.log('Content-Type:', response.headers['content-type']);
    
    if (response.headers['content-type'].includes('application/json')) {
      console.log('Resultado: SUCESSO! A API devolveu JSON.');
      // console.log('Corpo:', JSON.stringify(response.body, null, 2));
    } else {
      console.log('Resultado: FALHA! A API não devolveu JSON.');
      console.log('Corpo (primeiros 100 caracteres):', response.text.substring(0, 100));
    }
  } catch (error) {
    console.error('Erro no teste:', error);
  }
}

runTest();
