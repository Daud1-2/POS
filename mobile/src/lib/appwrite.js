import Constants from 'expo-constants';
import { Client, Account, ID } from 'react-native-appwrite';

const config = Constants.expoConfig?.extra || {};

const client = new Client()
  .setEndpoint(config.appwriteEndpoint)
  .setProject(config.appwriteProjectId)
  .setPlatform('com.orderly.app');

const account = new Account(client);

export { client, account, ID };
