import serverless from 'serverless-http';
import { app } from '../../src/server.js';

const serverlessHandler = serverless(app);

export const handler = async (event, context) => {
    // Prevent pg connection pool sockets from keeping the event loop active and hanging Lambda
    context.callbackWaitsForEmptyEventLoop = false;
    return await serverlessHandler(event, context);
};
