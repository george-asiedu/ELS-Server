import { PrismaClient } from '../generated/prisma-client/client';

export class Connection extends PrismaClient {
  constructor() {
      super({} as any); 
  }
  
  async connect() {
    try {
      await this.$connect();
      console.log('Database connected successfully.');
    } catch (error) {
      console.error('Error connecting to the database:', error);
      process.exit(1);
    }
  }

  async disconnect() {
    await this.$disconnect();
    console.log('Database disconnected successfully.');
  }
}