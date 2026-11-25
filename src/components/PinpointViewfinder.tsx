import React, { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Image,
  Dimensions,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text } from '../ui/Text';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PinpointViewfinderProps {
  visible: boolean;
  targetPhotoUrl: string;
  roundNumber: number;
  totalRounds: number;
  currentHeadingDeg: number;
  gpsAccuracyM?: number;
  mode?: 'hunt' | 'scout';
  onClose: () => void;
  onSubmitShot: (opacityUsed: number, photoUri?: string) => void;
}

export function PinpointViewfinder({
  visible,
  targetPhotoUrl,
  roundNumber,
  totalRounds,
  currentHeadingDeg,
  gpsAccuracyM = 3.2,
  mode = 'hunt',
  onClose,
  onSubmitShot,
}: PinpointViewfinderProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [ghostOpacity, setGhostOpacity] = useState<number>(0.5);
  const [capturing, setCapturing] = useState<boolean>(false);
  const cameraRef = useRef<CameraView>(null);

  if (!visible) return null;

  const cardinal =
    currentHeadingDeg >= 337.5 || currentHeadingDeg < 22.5
      ? 'N'
      : currentHeadingDeg < 67.5
        ? 'NE'
        : currentHeadingDeg < 112.5
          ? 'E'
          : currentHeadingDeg < 157.5
            ? 'SE'
            : currentHeadingDeg < 202.5
              ? 'S'
              : currentHeadingDeg < 247.5
                ? 'SW'
                : currentHeadingDeg < 292.5
                  ? 'W'
                  : 'NW';

  return (
    <View style={styles.overlayContainer}>
      {/* 1. Header Bar */}
      <View style={styles.headerBar}>
        <View style={styles.roundBadge}>
          <Text style={styles.roundBadgeText}>
            {mode === 'scout'
              ? `SCOUT PHASE • RD ${roundNumber}/${totalRounds}`
              : `PINPOINT • RD ${roundNumber}/${totalRounds}`}
          </Text>
        </View>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>CLOSE</Text>
        </TouchableOpacity>
      </View>

      {/* 2. Camera Viewfinder Area with Ghost Overlay */}
      <View style={styles.viewfinderFrame}>
        {/* Live Camera View with Simulated Fallback */}
        {permission?.granted ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={styles.cameraBackground}>
            <View style={styles.reticleCrosshair}>
              <View style={styles.reticleLineH} />
              <View style={styles.reticleLineV} />
              <View style={styles.reticleCenterDot} />
            </View>
            <TouchableOpacity
              style={styles.permissionPromptBtn}
              onPress={() => void requestPermission()}
            >
              <Text style={styles.permissionPromptText}>ENABLE LIVE CAMERA</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Semi-transparent onion skin ghost image (hunt mode only) */}
        {mode === 'hunt' && Boolean(targetPhotoUrl) && (
          <Image
            source={{ uri: targetPhotoUrl }}
            style={[styles.ghostImage, { opacity: ghostOpacity }]}
            resizeMode="cover"
          />
        )}

        {/* Framing corner brackets */}
        <View style={[styles.cornerBracket, styles.bracketTL]} />
        <View style={[styles.cornerBracket, styles.bracketTR]} />
        <View style={[styles.cornerBracket, styles.bracketBL]} />
        <View style={[styles.cornerBracket, styles.bracketBR]} />
      </View>

      {/* 3. Telemetry HUD Bar */}
      <View style={styles.telemetryBar}>
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>AZIMUTH</Text>
          <Text style={styles.telemetryValue}>
            {Math.round(currentHeadingDeg)}° {cardinal}
          </Text>
        </View>
        <View style={styles.telemetryDivider} />
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>GPS BUFFER</Text>
          <Text style={[styles.telemetryValue, gpsAccuracyM > 5 ? styles.accuracyAmber : styles.accuracyMint]}>
            ±{gpsAccuracyM.toFixed(1)}m
          </Text>
        </View>
        <View style={styles.telemetryDivider} />
        <View style={styles.telemetryItem}>
          <Text style={styles.telemetryLabel}>GHOST BLEND</Text>
          <Text style={styles.telemetryValue}>{Math.round(ghostOpacity * 100)}%</Text>
        </View>
      </View>

      {/* 4. Opacity Controls (hunt mode only) */}
      {mode === 'hunt' && (
        <View style={styles.opacitySelectorRow}>
          <Text style={styles.opacityTitle}>GHOST OVERLAY</Text>
          <View style={styles.opacityButtonGroup}>
            {[0.25, 0.5, 0.75, 1.0].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.opacityBtn,
                  Math.abs(ghostOpacity - val) < 0.05 && styles.opacityBtnActive,
                ]}
                onPress={() => setGhostOpacity(val)}
              >
                <Text
                  style={[
                    styles.opacityBtnText,
                    Math.abs(ghostOpacity - val) < 0.05 && styles.opacityBtnTextActive,
                  ]}
                >
                  {Math.round(val * 100)}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* 5. Shutter Action Button */}
      <View style={styles.shutterActionContainer}>
        <TouchableOpacity
          style={[styles.shutterButton, capturing && { opacity: 0.6 }]}
          activeOpacity={0.8}
          disabled={capturing}
          onPress={async () => {
            if (capturing) return;
            setCapturing(true);
            let photoUri: string | undefined;
            try {
              if (permission?.granted && cameraRef.current) {
                const pic = await cameraRef.current.takePictureAsync({ quality: 0.7 });
                photoUri = pic?.uri;
              }
            } catch {
              // Non-blocking fallback to coordinate/heading latch
            } finally {
              setCapturing(false);
              onSubmitShot(ghostOpacity, photoUri);
            }
          }}
        >
          <View style={styles.shutterInnerRing}>
            <Text style={styles.shutterButtonText}>
              {capturing
                ? 'LATCHING...'
                : mode === 'scout'
                  ? 'LATCH SCOUT TARGET'
                  : 'PINPOINT SHOT'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#090D14',
    zIndex: 9999,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 44 : 24,
    paddingBottom: 24,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  roundBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  roundBadgeText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 12,
    color: '#00F0FF',
    letterSpacing: 1.2,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeButtonText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 12,
    color: '#94A3B8',
    letterSpacing: 1,
  },
  viewfinderFrame: {
    width: SCREEN_WIDTH - 24,
    height: (SCREEN_WIDTH - 24) * 1.15,
    alignSelf: 'center',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.3)',
  },
  cameraBackground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permissionPromptBtn: {
    position: 'absolute',
    bottom: 20,
    backgroundColor: 'rgba(0, 240, 255, 0.15)',
    borderWidth: 1,
    borderColor: '#00F0FF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  permissionPromptText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 10,
    color: '#00F0FF',
    letterSpacing: 0.8,
  },
  ghostImage: {
    ...StyleSheet.absoluteFill,
  },
  reticleCrosshair: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleLineH: {
    position: 'absolute',
    width: 40,
    height: 1,
    backgroundColor: 'rgba(0, 240, 255, 0.4)',
  },
  reticleLineV: {
    position: 'absolute',
    width: 1,
    height: 40,
    backgroundColor: 'rgba(0, 240, 255, 0.4)',
  },
  reticleCenterDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#00F0FF',
  },
  cornerBracket: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderColor: '#00F0FF',
  },
  bracketTL: {
    top: 6,
    left: 6,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  bracketTR: {
    top: 6,
    right: 6,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  bracketBL: {
    bottom: 6,
    left: 6,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  bracketBR: {
    bottom: 6,
    right: 6,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  telemetryBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#111827',
    marginHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  telemetryItem: {
    alignItems: 'center',
  },
  telemetryLabel: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 9,
    color: '#64748B',
    letterSpacing: 0.8,
  },
  telemetryValue: {
    fontFamily: 'Archivo-Bold',
    fontSize: 13,
    color: '#F1F5F9',
    marginTop: 2,
  },
  accuracyMint: {
    color: '#10B981',
  },
  accuracyAmber: {
    color: '#F59E0B',
  },
  telemetryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1F2937',
  },
  opacitySelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  opacityTitle: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 11,
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  opacityButtonGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  opacityBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  opacityBtnActive: {
    backgroundColor: '#00F0FF',
    borderColor: '#00F0FF',
  },
  opacityBtnText: {
    fontFamily: 'SegoeUI-Bold',
    fontSize: 11,
    color: '#94A3B8',
  },
  opacityBtnTextActive: {
    color: '#090D14',
  },
  shutterActionContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  shutterButton: {
    width: SCREEN_WIDTH - 40,
    height: 52,
    borderRadius: 6,
    backgroundColor: '#00F0FF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#00F0FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  shutterInnerRing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButtonText: {
    fontFamily: 'Archivo-Bold',
    fontSize: 14,
    color: '#090D14',
    letterSpacing: 1.5,
  },
});
