import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { useUnistyles } from "react-native-unistyles";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

const TabBarIcon = ({
  name,
  color,
}: {
  name: IoniconsName;
  color: ColorValue;
}) => <Ionicons name={name} size={20} color={color} />;

const TabLayout = () => {
  const { theme } = useUnistyles();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.chart,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="apps-outline" />
          ),
          title: "Sites",
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="stats-chart-outline" />
          ),
          title: "Dashboard",
        }}
      />
      <Tabs.Screen
        name="visitors"
        options={{
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="people-outline" />
          ),
          title: "Visitors",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ color }) => (
            <TabBarIcon color={color} name="settings-outline" />
          ),
          title: "Settings",
        }}
      />
    </Tabs>
  );
};

export default TabLayout;
