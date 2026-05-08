import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import LoginScreen     from './src/screens/LoginScreen';
import HomeScreen      from './src/screens/HomeScreen';
import ProfileScreen   from './src/screens/ProfileScreen';
import LogRoundScreen  from './src/screens/LogRoundScreen';
import ClubScreen      from './src/screens/ClubScreen';
import ClubSetupScreen         from './src/screens/ClubSetupScreen';
import CreateCompetitionScreen from './src/screens/CreateCompetitionScreen';
import CompetitionScreen       from './src/screens/CompetitionScreen';

// ── Types ────────────────────────────────────────────────────────────────────

export type User = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  handicap?: number | null;
  club_name?: string | null;
};

export type RootStackParamList = {
  Login:     undefined;
  Tabs:      { user: User };
  LogRound:  undefined;
  ClubSetup:         undefined;
  CreateCompetition: { clubId: number; clubName: string };
  Competition:       { competitionId: number; userId: string };
  Club:              { clubId: number; clubName: string; role: string; code: string; userId: string };
};

type TabParamList = {
  Home:    { user: User };
  Profile: { userId: string };
};

// ── Navigators ───────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<TabParamList>();

const GREEN = '#1a7f3c';


function TabsRoot({ route }: { route: { params: { user: User } } }) {
  const { user } = route.params;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: '#b0b0b0',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#f0f0f0',
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        initialParams={{ user }}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        initialParams={{ userId: user.id }}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login"    component={LoginScreen} />
        <Stack.Screen name="Tabs"     component={TabsRoot} />
        <Stack.Screen
          name="LogRound"
          component={LogRoundScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="ClubSetup"
          component={ClubSetupScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="CreateCompetition"
          component={CreateCompetitionScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="Competition"
          component={CompetitionScreen}
          options={{
            headerShown: true,
            title: 'Competition',
            headerTintColor: GREEN,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: '#f5f5f7' },
          }}
        />
        <Stack.Screen
          name="Club"
          component={ClubScreen}
          options={({ route }) => ({
            headerShown: true,
            title: route.params.clubName,
            headerTintColor: GREEN,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: '#f5f5f7' },
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

