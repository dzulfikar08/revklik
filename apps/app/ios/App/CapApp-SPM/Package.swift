// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/.bun/@capacitor+app@8.1.1+6139e07751574bda/node_modules/@capacitor/app"),
        .package(name: "CapacitorHaptics", path: "../../../../../node_modules/.bun/@capacitor+haptics@8.0.2+6139e07751574bda/node_modules/@capacitor/haptics"),
        .package(name: "CapacitorNetwork", path: "../../../../../node_modules/.bun/@capacitor+network@8.0.1+6139e07751574bda/node_modules/@capacitor/network"),
        .package(name: "CapacitorPreferences", path: "../../../../../node_modules/.bun/@capacitor+preferences@8.0.1+6139e07751574bda/node_modules/@capacitor/preferences"),
        .package(name: "CapacitorPushNotifications", path: "../../../../../node_modules/.bun/@capacitor+push-notifications@8.1.2+6139e07751574bda/node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorSplashScreen", path: "../../../../../node_modules/.bun/@capacitor+splash-screen@8.0.2+6139e07751574bda/node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../../../node_modules/.bun/@capacitor+status-bar@8.0.3+6139e07751574bda/node_modules/@capacitor/status-bar"),
        .package(name: "CapgoCapacitorNativeBiometric", path: "../../../../../node_modules/.bun/@capgo+capacitor-native-biometric@8.6.7+6139e07751574bda/node_modules/@capgo/capacitor-native-biometric")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorHaptics", package: "CapacitorHaptics"),
                .product(name: "CapacitorNetwork", package: "CapacitorNetwork"),
                .product(name: "CapacitorPreferences", package: "CapacitorPreferences"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapgoCapacitorNativeBiometric", package: "CapgoCapacitorNativeBiometric")
            ]
        )
    ]
)
