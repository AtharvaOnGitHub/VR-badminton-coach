// Expo Go and native builds both enter here.
// SDK 54 removed expo/AppEntry.js, so the entry point is explicit now.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
