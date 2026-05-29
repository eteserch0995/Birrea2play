import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import MundialHomeScreen     from '../screens/mundial/MundialHomeScreen';
import MundialEnrollScreen   from '../screens/mundial/MundialEnrollScreen';
import MundialSurvivorScreen from '../screens/mundial/MundialSurvivorScreen';
import MundialPollaScreen    from '../screens/mundial/MundialPollaScreen';

const Stack = createStackNavigator();

// Stack interno del módulo Mundial 2026.
// Home → Enroll → Survivor/Polla.
export default function MundialNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MundialHome"     component={MundialHomeScreen} />
      <Stack.Screen name="MundialEnroll"   component={MundialEnrollScreen} />
      <Stack.Screen name="MundialSurvivor" component={MundialSurvivorScreen} />
      <Stack.Screen name="MundialPolla"    component={MundialPollaScreen} />
    </Stack.Navigator>
  );
}
