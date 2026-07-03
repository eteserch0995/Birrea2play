import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import MundialHomeScreen      from '../screens/mundial/MundialHomeScreen';
import MundialEnrollScreen    from '../screens/mundial/MundialEnrollScreen';
import MundialSurvivorScreen  from '../screens/mundial/MundialSurvivorScreen';
import MundialPollaScreen     from '../screens/mundial/MundialPollaScreen';
import MundialFreePollaScreen from '../screens/mundial/MundialFreePollaScreen';
import MundialRulesScreen     from '../screens/mundial/MundialRulesScreen';
import MundialOnboardingScreen from '../screens/mundial/MundialOnboardingScreen';
import MundialTermsScreen     from '../screens/mundial/MundialTermsScreen';
import MundialMatchesScreen   from '../screens/mundial/MundialMatchesScreen';
import MundialStandingsScreen from '../screens/mundial/MundialStandingsScreen';

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
      <Stack.Screen name="MundialFreePolla" component={MundialFreePollaScreen} />
      <Stack.Screen name="MundialRules"    component={MundialRulesScreen} />
      <Stack.Screen name="MundialOnboarding" component={MundialOnboardingScreen} />
      <Stack.Screen name="MundialTerms"     component={MundialTermsScreen} />
      <Stack.Screen name="MundialMatches"   component={MundialMatchesScreen} />
      <Stack.Screen name="MundialStandings" component={MundialStandingsScreen} />
    </Stack.Navigator>
  );
}
