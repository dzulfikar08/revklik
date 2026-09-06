import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { TextInputProps, TouchableOpacityProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

/* --------------------------------- button ---------------------------------- */

type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";
type ButtonSize = "sm" | "md";

interface ButtonProps extends TouchableOpacityProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IoniconsName;
  busy?: boolean;
  label: string;
}

export const Button = ({
  variant = "primary",
  size = "md",
  icon,
  busy = false,
  label,
  disabled,
  style,
  ...rest
}: ButtonProps) => {
  styles.useVariants({ size, variant });
  const disabledFinal = disabled || busy;
  return (
    <TouchableOpacity
      disabled={disabledFinal}
      style={[styles.button, disabledFinal && styles.buttonDisabled, style]}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          style={styles.spinner}
          color={variant === "primary" ? "#12161D" : "#949AA3"}
        />
      ) : null}
      {icon && !busy ? (
        <Ionicons
          name={icon}
          size={size === "sm" ? 13 : 15}
          style={styles.icon}
        />
      ) : null}
      <Text style={styles.buttonLabel}>{label}</Text>
    </TouchableOpacity>
  );
};

/* ---------------------------------- input ---------------------------------- */

interface InputProps extends TextInputProps {
  label?: string;
}

export const Input = ({ label, style, ...rest }: InputProps) => (
  <View>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <TextInput
      placeholderTextColor="#949AA3"
      style={[styles.input, style]}
      {...rest}
    />
  </View>
);

/* ---------------------------------- misc ----------------------------------- */

export const Row = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text numberOfLines={1} style={[styles.rowValue, mono && styles.mono]}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create((theme) => ({
  button: {
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: theme.colors.background,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    variants: {
      size: {
        md: {
          fontSize: theme.fontSize.sm,
        },
        sm: {
          fontSize: theme.fontSize.xs,
        },
      },
      variant: {
        destructive: {
          color: "#FFFFFF",
        },
        ghost: {
          color: theme.colors.mutedForeground,
        },
        outline: {
          color: theme.colors.foreground,
        },
        primary: {
          color: theme.colors.primaryForeground,
        },
      },
    },
  },
  icon: {
    marginRight: 6,
    variants: {
      variant: {
        destructive: {
          color: "#FFFFFF",
        },
        ghost: {
          color: theme.colors.mutedForeground,
        },
        outline: {
          color: theme.colors.foreground,
        },
        primary: {
          color: theme.colors.primaryForeground,
        },
      },
    },
  },
  input: {
    backgroundColor: theme.colors.input,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
    marginBottom: 6,
  },
  mono: {
    fontFamily: "monospace",
    fontSize: theme.fontSize.xs,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  rowLabel: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.xs,
  },
  rowValue: {
    color: theme.colors.foreground,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "500",
    textAlign: "right",
  },
  spinner: {
    marginRight: 8,
  },
}));
