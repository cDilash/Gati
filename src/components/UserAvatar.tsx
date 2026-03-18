/**
 * UserAvatar — reusable profile picture with gradient border.
 * Shows photo if available, gradient first-letter if not.
 * Tap to change photo (optional).
 */

import { useState } from 'react';
import { View, Image, StyleSheet, ActionSheetIOS, Platform, Alert } from 'react-native';
import { Text } from 'tamagui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

interface Props {
  size?: number;
  name?: string | null;
  avatarBase64?: string | null;
  editable?: boolean;
  onAvatarChanged?: (base64: string | null) => void;
}

export function UserAvatar({ size = 80, name, avatarBase64, editable = false, onAvatarChanged }: Props) {
  const borderW = size >= 60 ? 2.5 : 1.5;
  const innerSize = size - borderW * 2;
  const initial = (name ?? 'A').charAt(0).toUpperCase();
  const fontSize = size >= 60 ? size * 0.4 : size * 0.45;

  const handleTap = async () => {
    if (!editable || !onAvatarChanged) return;

    const options = avatarBase64
      ? ['Take Photo', 'Choose from Library', 'Remove Photo', 'Cancel']
      : ['Take Photo', 'Choose from Library', 'Cancel'];
    const cancelIdx = options.length - 1;
    const destructiveIdx = avatarBase64 ? 2 : -1;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIdx, destructiveButtonIndex: destructiveIdx },
        async (idx) => {
          if (idx === 0) await pickImage('camera');
          else if (idx === 1) await pickImage('library');
          else if (idx === 2 && avatarBase64) onAvatarChanged(null);
        }
      );
    } else {
      Alert.alert('Profile Photo', '', [
        { text: 'Take Photo', onPress: () => pickImage('camera') },
        { text: 'Choose from Library', onPress: () => pickImage('library') },
        ...(avatarBase64 ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: () => onAvatarChanged(null) }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    try {
      const ImagePicker = require('expo-image-picker');
      const options = {
        allowsEditing: true,
        aspect: [1, 1] as [number, number],
        quality: 0.7,
        base64: true,
      };

      let result;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission Required', 'Camera access is needed.'); return; }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission Required', 'Photo library access is needed.'); return; }
        result = await ImagePicker.launchImageLibraryAsync(options);
      }

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      let base64 = asset.base64;

      // Resize if needed
      if (asset.width > 200 || asset.height > 200) {
        try {
          const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
          const manipulated = await manipulateAsync(
            asset.uri,
            [{ resize: { width: 200, height: 200 } }],
            { format: SaveFormat.JPEG, compress: 0.7, base64: true }
          );
          base64 = manipulated.base64;
        } catch {}
      }

      if (base64 && onAvatarChanged) {
        onAvatarChanged(base64);
      }
    } catch (e: any) {
      console.warn('[Avatar] Pick failed:', e);
    }
  };

  return (
    <View
      style={[styles.outer, { width: size, height: size, borderRadius: size / 2, borderWidth: borderW }]}
      onTouchEnd={editable ? handleTap : undefined}
    >
      {avatarBase64 ? (
        <Image
          source={{ uri: `data:image/jpeg;base64,${avatarBase64}` }}
          style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }}
        />
      ) : (
        <View style={[styles.fallback, { width: innerSize, height: innerSize, borderRadius: innerSize / 2 }]}>
          <Text fontFamily="$mono" fontSize={fontSize} fontWeight="800" color={colors.cyan}>
            {initial}
          </Text>
        </View>
      )}

      {/* Camera overlay for editable */}
      {editable && (
        <View style={[styles.cameraOverlay, { right: 0, bottom: 0 }]}>
          <MaterialCommunityIcons name="camera" size={12} color={colors.textPrimary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  fallback: {
    backgroundColor: colors.cyanGhost,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOverlay: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
