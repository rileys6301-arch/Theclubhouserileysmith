import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Animated, StyleSheet, TouchableOpacity, View, Text, Pressable,
} from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import client from './src/api/client';
import BootstrapScreen         from './src/screens/BootstrapScreen';
import LoginScreen             from './src/screens/LoginScreen';
import RegisterScreen          from './src/screens/RegisterScreen';
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
import TournamentScoringScreen  from './src/screens/TournamentScoringScreen';
import ManualCourseEntryScreen  from './src/screens/ManualCourseEntryScreen';
import { ManualCourseResult, ManualCourseTee } from './src/screens/ManualCourseEntryScreen';
import RoundDetailScreen        from './src/screens/RoundDetailScreen';
import ClubActivityScreen        from './src/screens/NoticeBoardScreen';
import SocialFeedScreen         from './src/screens/SocialFeedScreen';
import ClubStatsScreen            from './src/screens/ClubStatsScreen';
import TournamentGroupScreen      from './src/screens/TournamentGroupScreen';
import LiveRoundScreen,
  { LiveHole }                    from './src/screens/LiveRoundScreen';
import { registerForPushNotifications } from './src/utils/registerNotifications';
import { DrawerContext } from './src/context/DrawerContext';
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
  Bootstrap:      undefined;
  Login:          undefined;
  Register:       undefined;
  Home:           { user: User };
  ClubTabs:       { user: User; clubId: number; clubName: string; role: string; code: string };
  LogRound:       undefined;
  AllTournaments: undefined;
  ClubSetup:         undefined;
  CreateCompetition: { clubId?: number; clubName?: string };
  Competition:       { competitionId: number; userId: string };
  ClubAdmin:          { clubId: number; clubName: string; role: string; userId: string };
  MemberProfile:      { userId: string; name?: string };
  Hall:               { clubId: number; clubName: string };
  TournamentScoring:  { competitionId: number; userId: string };
  ManualCourse:       { onSave: (course: ManualCourseResult, tees: ManualCourseTee[]) => void };
  RoundDetail:        { roundId: string };
  ClubActivity:       { clubId: number; clubName: string; userId: string };
  SocialFeed:         { clubId: number; clubName: string; userId: string };
  ClubStats:          { clubId: number; clubName: string };
  TournamentGroup:    { groupId: number; userId: string; clubId: number; clubName: string; role: string };
  Profile:            { userId: string };
  LiveRound: {
    roundId: number;
    holeData: LiveHole[];
    courseHcp: number;
    courseName: string;
    teeName: string;
    competitionName?: string | null;
    initScores: (number | null)[];
    user: User;
  };
};

type ClubTabParamList = {
  ClubHome:      { clubId: number; clubName: string; role: string; code: string; userId: string };
  SocialFeedTab: { clubId: number; clubName: string; userId: string };
  Members:       { clubId: number };
  Tournaments:   { clubId: number; userId: string };
  Profile:       { userId: string };
  Play:          undefined;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DRAWER_W = 280;

// ── DrawerItem ────────────────────────────────────────────────────────────────

function DrawerItem({
  icon, label, onPress, active,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[di.item, active && di.itemActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={20} color={active ? colors.primary : '#6B7280'} />
      <Text style={[di.label, active && di.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const di = StyleSheet.create({
  item:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, gap: 14 },
  itemActive:  { backgroundColor: `${colors.primary}18` },
  label:       { fontSize: 15, color: '#374151', fontWeight: '500' },
  labelActive: { color: colors.primary, fontWeight: '600' },
});

// ── Navigators ────────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab   = createBottomTabNavigator<ClubTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function ClubTabsRoot({
  route,
  navigation,
}: {
  route: { params: { user: User; clubId: number; clubName: string; role: string; code: string } };
  navigation: any;
}) {
  const { user, clubId, clubName, role, code } = route.params;
  const insets = useSafeAreaInsets();
  const isAdminOrOwner = role === 'owner' || role === 'admin';

  useEffect(() => { registerForPushNotifications(); }, []);

  // ── Drawer animation ──────────────────────────────────────────────────────
  const drawerX      = useRef(new Animated.Value(-DRAWER_W)).current;
  const overlayAlpha = useRef(new Animated.Value(0)).current;
  const [isOpen, setIsOpen] = useState(false);

  // ── Tab tracking ──────────────────────────────────────────────────────────
  const tabNavRef  = useRef<any>(null);
  const [activeTab, setActiveTab] = useState('ClubHome');

  const openDrawer = useCallback(() => {
    setIsOpen(true);
    Animated.parallel([
      Animated.spring(drawerX,      { toValue: 0,        bounciness: 0, speed: 14, useNativeDriver: true }),
      Animated.timing(overlayAlpha, { toValue: 0.5, duration: 200,                 useNativeDriver: true }),
    ]).start();
  }, [drawerX, overlayAlpha]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.timing(drawerX,      { toValue: -DRAWER_W, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayAlpha, { toValue: 0,          duration: 220, useNativeDriver: true }),
    ]).start(() => setIsOpen(false));
  }, [drawerX, overlayAlpha]);

  function goToTab(name: string) {
    tabNavRef.current?.navigate(name);
    closeDrawer();
  }

  // Stable component so Tab.Navigator doesn't remount it on every render
  const TabBarCapture = useMemo(() => {
    return function TabBarCaptureInner({ state, navigation: tabNav }: any) {
      useEffect(() => {
        tabNavRef.current = tabNav;
        const name = state.routes[state.index]?.name;
        if (name) setActiveTab(name);
      });
      return null;
    };
  }, []); // tabNavRef and setActiveTab are stable references

  const showFloatingHamburger = activeTab !== 'ClubHome' && activeTab !== 'SocialFeedTab';

  return (
    <DrawerContext.Provider value={{ openDrawer, hasDrawer: true }}>
      <View style={{ flex: 1 }}>

        {/* ── Tab screens (no visible tab bar) ── */}
        <Tab.Navigator
          tabBar={props => <TabBarCapture {...props} />}
          screenOptions={{ headerShown: false }}
        >
          <Tab.Screen
            name="ClubHome"
            component={ClubScreen}
            initialParams={{ clubId, clubName, role, code, userId: user.id }}
          />
          <Tab.Screen
            name="SocialFeedTab"
            component={SocialFeedScreen}
            initialParams={{ clubId, clubName, userId: user.id }}
          />
          <Tab.Screen
            name="Members"
            component={MembersScreen}
            initialParams={{ clubId }}
          />
          <Tab.Screen
            name="Tournaments"
            component={TournamentsScreen}
            initialParams={{ clubId, userId: user.id }}
          />
          <Tab.Screen
            name="Profile"
            component={ProfileScreen}
            initialParams={{ userId: user.id }}
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
          />
        </Tab.Navigator>

        {/* ── Floating hamburger for Members / Tournaments / Profile ── */}
        {showFloatingHamburger && (
          <View style={[ds.floatingBtn, { top: insets.top + 12 }]} pointerEvents="box-none">
            <TouchableOpacity
              onPress={openDrawer}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={ds.floatingBtnInner}
            >
              <Ionicons name="menu" size={24} color={colors.primary} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Dark overlay ── */}
        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          style={[ds.overlay, { opacity: overlayAlpha }]}
        >
          <Pressable style={{ flex: 1 }} onPress={closeDrawer} />
        </Animated.View>

        {/* ── Drawer panel ── */}
        <Animated.View style={[ds.drawer, { transform: [{ translateX: drawerX }] }]}>
          <View style={[ds.drawerHeader, { paddingTop: insets.top + 20 }]}>
            <Ionicons name="golf" size={22} color={colors.primary} style={{ marginBottom: 6 }} />
            <Text style={ds.drawerClubName} numberOfLines={2}>{clubName}</Text>
          </View>

          <DrawerItem icon="golf-outline"    label="Club"         onPress={() => goToTab('ClubHome')}      active={activeTab === 'ClubHome'} />
          <DrawerItem icon="newspaper-outline" label="Social Feed" onPress={() => goToTab('SocialFeedTab')} active={activeTab === 'SocialFeedTab'} />
          <DrawerItem icon="people-outline"  label="Members"      onPress={() => goToTab('Members')}       active={activeTab === 'Members'} />
          <DrawerItem icon="trophy-outline"  label="Tournaments"  onPress={() => goToTab('Tournaments')}   active={activeTab === 'Tournaments'} />
          <DrawerItem icon="person-outline"  label="Profile"      onPress={() => goToTab('Profile')}       active={activeTab === 'Profile'} />

          <View style={ds.divider} />

          <DrawerItem icon="trophy-outline"      label="Hall of Fame" onPress={() => { closeDrawer(); navigation.navigate('Hall', { clubId, clubName }); }} />
          <DrawerItem icon="bar-chart-outline"  label="Club Stats"   onPress={() => { closeDrawer(); navigation.navigate('ClubStats', { clubId, clubName }); }} />
          <DrawerItem icon="add-circle-outline" label="Log Round"   onPress={() => { closeDrawer(); navigation.navigate('LogRound'); }} />
          <DrawerItem icon="home-outline"        label="Home"        onPress={() => { closeDrawer(); navigation.goBack(); }} />
          {isAdminOrOwner && (
            <DrawerItem
              icon="settings-outline"
              label="Settings"
              onPress={() => {
                closeDrawer();
                navigation.navigate('ClubAdmin', { clubId, clubName, role, userId: user.id });
              }}
            />
          )}
        </Animated.View>

      </View>
    </DrawerContext.Provider>
  );
}

// ── Drawer styles ─────────────────────────────────────────────────────────────

const ds = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 20,
  },
  drawer: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: DRAWER_W,
    backgroundColor: colors.surface,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  drawerHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  drawerClubName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 20,
    marginVertical: 8,
  },
  floatingBtn: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  floatingBtnInner: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
});

// ── Global live-round banner ──────────────────────────────────────────────────
// Rendered inside NavigationContainer so it can call useNavigation/useNavigationState.
// Floats above every screen; disappears when the user is already on LiveRound.

function GlobalLiveRoundBanner({ currentRoute }: { currentRoute: string | null }) {
  const insets      = useSafeAreaInsets();
  const [liveRound, setLiveRound] = useState<any>(null);
  const prevRoute   = useRef<string | null>(null);

  async function poll() {
    try {
      const { data } = await client.get('/api/rounds/my-live');
      setLiveRound(data);
    } catch {
      setLiveRound(null);
    }
  }

  // Poll every 15 s.
  useEffect(() => {
    let alive = true;
    async function pollAlive() {
      try {
        const { data } = await client.get('/api/rounds/my-live');
        if (alive) setLiveRound(data);
      } catch {
        if (alive) setLiveRound(null);
      }
    }
    pollAlive();
    const id = setInterval(pollAlive, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Re-poll immediately whenever the user leaves a scoring screen so the
  // banner appears without waiting up to 15 s for the next scheduled poll.
  useEffect(() => {
    const leaving = prevRoute.current;
    prevRoute.current = currentRoute;
    if ((leaving === 'LiveRound' || leaving === 'LogRound') && currentRoute !== leaving) {
      poll();
    }
  }, [currentRoute]);

  if (!liveRound || currentRoute === 'LiveRound') return null;

  async function returnToRound() {
    if (!navigationRef.isReady()) return;
    try {
      // Always fetch fresh data so initScores reflects the latest saved holes.
      const [liveRes, userRes] = await Promise.all([
        client.get('/api/rounds/my-live'),
        client.get<User>('/api/users/profile'),
      ]);
      const fresh = liveRes.data;
      if (!fresh) return;
      setLiveRound(fresh);
      const holeData   = fresh.hole_data ?? [];
      const initScores = holeData.map((_: any, i: number) => {
        const sh = (fresh.scored_holes ?? []).find((h: any) => h.hole_number === i + 1);
        return sh?.score ?? null;
      });
      navigationRef.navigate('LiveRound', {
        roundId:         fresh.id,
        holeData,
        courseHcp:       fresh.course_handicap ?? 0,
        courseName:      fresh.course_name,
        teeName:         fresh.tee_name ?? '',
        competitionName: null,
        initScores,
        user:            userRes.data,
      });
    } catch {}
  }

  return (
    <TouchableOpacity
      style={[gb.banner, { bottom: insets.bottom + 16 }]}
      onPress={returnToRound}
      activeOpacity={0.88}
    >
      <View style={gb.dot} />
      <View style={gb.text}>
        <Text style={gb.title}>Round In Progress</Text>
        <Text style={gb.sub} numberOfLines={1}>{liveRound.course_name}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
    </TouchableOpacity>
  );
}

const G_DARK = '#2a4a18';

const gb = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 16, right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: G_DARK,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    shadowColor: G_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 999,
  },
  dot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: '#6fcf5a' },
  text:  { flex: 1 },
  title: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sub:   { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
});

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<string | null>(null);

  function handleStateChange() {
    if (!navigationRef.isReady()) return;
    const route = navigationRef.getCurrentRoute();
    setCurrentRoute(route?.name ?? null);
  }

  return (
    <SafeAreaProvider>
    <NavigationContainer ref={navigationRef} onStateChange={handleStateChange}>
      <StatusBar style="auto" />
      <Stack.Navigator initialRouteName="Bootstrap" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Bootstrap" component={BootstrapScreen} />
        <Stack.Screen name="Login"    component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Home"     component={HomeScreen} />
        <Stack.Screen name="ClubTabs" component={ClubTabsRoot} />
        <Stack.Screen
          name="LogRound"
          component={LogRoundScreen}
          options={{ presentation: 'fullScreenModal', gestureEnabled: false }}
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
          name="TournamentScoring"
          component={TournamentScoringScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
            headerShown: false,
            // Disable swipe-down-to-dismiss: same risk as LiveRound — accidental
            // swipe exits the scoring session mid-round and loses uncommitted stats.
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="ManualCourse"
          component={ManualCourseEntryScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }}
        />
        <Stack.Screen
          name="RoundDetail"
          component={RoundDetailScreen}
          options={{
            headerShown: true,
            title: 'Round',
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          }}
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
        <Stack.Screen
          name="ClubStats"
          component={ClubStatsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="TournamentGroup"
          component={TournamentGroupScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="ClubActivity"
          component={ClubActivityScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SocialFeed"
          component={SocialFeedScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            headerShown: true,
            title: 'Edit Profile',
            headerTintColor: colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: '#111', fontSize: 17 },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
          }}
        />
        <Stack.Screen
          name="LiveRound"
          component={LiveRoundScreen}
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            gestureEnabled: false,
          }}
        />
      </Stack.Navigator>

      {/* Floats above every screen except LiveRound itself */}
      <GlobalLiveRoundBanner currentRoute={currentRoute} />

    </NavigationContainer>
    </SafeAreaProvider>
  );
}
