import { Client, Account } from 'appwrite';

const client = new Client()
  .setEndpoint('https://fra.cloud.appwrite.io/v1')
  .setProject('698974820021316226bd');

const account = new Account(client);

export { client, account };
