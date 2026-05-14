import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import LoginScreen             from './src/screens/LoginScreen';
import HomeScreen              from './src/screens/HomeScreen';
import ProfileScreen           from './src/screens/ProfileScreen';
import LogRoundScreen          from './src/screens/LogRoundScreen';
import ClubScreen              from './src/screens/ClubScreen';
import ClubSetupScreen         from './src/screens/ClubSetupScreen';
import CreateCompetitionScreen from './src/screens/CreateCompetitionScreen';
import CompetitionScreen       from './src/screens/CompetitionScreen';
import MemberProfileScreen     from './src/screens/MemberProfileScreen';
import MembersScreen           from './src/screens/MembersScreen';
import ClubAdminScreen         from './src/screens/ClubAdminScreen';
import HallScreen              from './src/screens/HallScreen';
import TournamentsScreen       from './src/screens/TournamentsScreen';
import PlayScreen              from './src/screens/PlayScreen';
import { colors }              from './src/theme';

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
  Login:          undefined;
  Home:           { user: User };
  ClubTabs:       { user: User; clubId: number; clubName: string; role: string; code: string };
  LogRound:       undefined;
  AllTournaments: undefined;
  ClubSetup:         undefined;
  CreateCompetition: { clubId: number; clubName: string };
  Competition:       { competitionId: number; userId: string };
  ClubAdmin:         { clubId: number; clubName: string; role: string; userId: string };
  MemberProfile:     { userId: string; name?: string };
  Hall:              { clubId: number; clubName: string };
};

type ClubTabParamList = {
  ClubHome:    { clubId: number; clubName: string; role: string; code: string; userId: string };
  Play:        undefined;
  Members:     { clubId: number };
  Tournaments: { clubId: number };
  Profile:     { userId: string };
};

// ── Navigators ───────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<ClubTabParamList>();

function ClubTabsRoot({ route, navigation }: { route: { params: { user: User; clubId: number; clubName: string; role: string; code: string } }; navigation: any }) {
  const { user, clubId, clubName, role, code } = route.params;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   colors.primary,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor:  colors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="ClubHome"
        component={ClubScreen}
        initialParams={{ clubId, clubName, role, code, userId: user.id }}
        options={{
          tabBarLabel: 'Club',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'golf' : 'golf-outline'} size={24} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Play"
        component={PlayScreen}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('LogRound');
          },
        }}
        options={{
          tabBarLabel: 'Play',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'add-circle' : 'add-circle-outline'} size={24} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Members"
        component={MembersScreen}
        initialParams={{ clubId }}
        options={{
          tabBarLabel: 'Members',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={24} color={color} />
          ),
        }}
      />

      <Tab.Screen
        name="Tournaments"
        component={TournamentsScreen}
        initialParams={{ clubId }}
        options={{
          tabBarLabel: 'Tournaments',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'trophy' : 'trophy-outline'} size={24} color={color} />
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
        <Stack.Screen name="Home"     component={HomeScreen} />
        <Stack.Screen name="ClubTabs" component={ClubTabsRoot} />
        <Stack.Screen
          name="LogRound"
          component={LogRoundScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="AllTournaments"
          component={TournamentsScreen}
          options={{
            headerShown: true,
            title: 'Tournaments',
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          }}
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
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          }}
        />
        <Stack.Screen
          name="MemberProfile"
          component={MemberProfileScreen}
          options={({ route }) => ({
            headerShown: true,
            title: route.params.name || 'Player Profile',
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          })}
        />
        <Stack.Screen
          name="Hall"
          component={HallScreen}
          options={({ route }) => ({
            headerShown: true,
            title: route.params.clubName,
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          })}
        />
        <Stack.Screen
          name="ClubAdmin"
          component={ClubAdminScreen}
          options={({ route }) => ({
            headerShown: true,
            title: route.params.clubName,
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
