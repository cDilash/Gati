/**
 * Setup Wizard — 8-step onboarding with Tamagui components.
 * Keeps: Modal, KeyboardAvoidingView, DateTimePicker, Alert, ScrollView (RN for RefreshControl in modals)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Modal, Pressable, ScrollView as RNScrollView } from 'react-native';
import { YStack, XStack, Text, View, Input, Spinner, ScrollView } from 'tamagui';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useAppStore } from '../src/store';
import { UserProfile } from '../src/types';
import { calculateVDOTFrom5K, calculateVDOTFrom10K, calculateVDOTFromHalf, formatTime } from '../src/engine/vdot';
import { PlanGenerationLoader } from '../src/components/common/PlanGenerationLoader';
import type { StravaProfileData } from '../src/strava/profileImport';

const H = (props: any) => <Text fontFamily="$heading" {...props} />;
const B = (props: any) => <Text fontFamily="$body" {...props} />;
const M = (props: any) => <Text fontFamily="$mono" {...props} />;

const TOTAL_STEPS = 8;
const RACE_DISTANCES = ['5K', '10K', 'Half Marathon'] as const;
type RaceDistance = (typeof RACE_DISTANCES)[number];
const GENDERS = ['Male', 'Female'] as const;
type Gender = (typeof GENDERS)[number];
const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
const COURSE_PROFILES = ['Flat', 'Rolling', 'Hilly', 'Unknown'] as const;
type CourseProfile = (typeof COURSE_PROFILES)[number];
const GOAL_TYPES = ['Just Finish', 'Time Goal', 'BQ', 'PR'] as const;
type GoalType = (typeof GOAL_TYPES)[number];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const INJURIES = ['Shin Splints', 'Knee Pain', 'IT Band', 'Plantar Fasciitis', 'Achilles', 'Hip Pain', 'Hamstring', 'Calf Strain', 'None'] as const;
const WEAKNESSES = ['Hills', 'Heat', 'Nutrition', 'Mental', 'Speed', 'Endurance', 'Pacing', 'Recovery'] as const;

function parseRaceTime(str: string): number | null {
  const t = str.trim(); if (!t) return null;
  const p = t.split(':').map(Number); if (p.some(isNaN)) return null;
  return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p.length === 2 ? p[0]*60+p[1] : null;
}

// ─── Reusable Sub-components ────────────────────────────────

const FieldLabel = ({ text, fromStrava }: { text: string; fromStrava?: boolean }) => (
  <XStack alignItems="center" gap="$2" marginTop="$4" marginBottom="$2">
    <B color="$textSecondary" fontSize={14} fontWeight="600">{text}</B>
    {fromStrava && <B color="$strava" fontSize={11} fontWeight="600" backgroundColor="$stravaMuted" paddingHorizontal="$1" paddingVertical={2} borderRadius="$1">from Strava</B>}
  </XStack>
);

const SegmentedControl = <T extends string>({ options, selected, onSelect }: { options: readonly T[]; selected: T; onSelect: (v: T) => void }) => (
  <XStack backgroundColor="$surface" borderRadius="$4" borderWidth={1} borderColor="$border" overflow="hidden">
    {options.map(opt => (
      <YStack key={opt} flex={1} paddingVertical="$3" alignItems="center" backgroundColor={selected === opt ? '$accent' : 'transparent'}
        pressStyle={{ opacity: 0.8 }} onPress={() => onSelect(opt)}>
        <B color={selected === opt ? 'white' : '$textSecondary'} fontSize={14} fontWeight={selected === opt ? '700' : '500'}>{opt}</B>
      </YStack>
    ))}
  </XStack>
);

const ChipSelect = ({ options, selected, onToggle }: { options: readonly string[]; selected: string[]; onToggle: (v: string) => void }) => (
  <XStack flexWrap="wrap" gap="$2">
    {options.map(opt => (
      <YStack key={opt} paddingHorizontal="$3" paddingVertical="$2" borderRadius={20}
        backgroundColor={selected.includes(opt) ? '$accent' : '$surface'} borderWidth={1}
        borderColor={selected.includes(opt) ? '$accent' : '$border'}
        pressStyle={{ opacity: 0.8 }} onPress={() => onToggle(opt)}>
        <B color={selected.includes(opt) ? 'white' : '$textSecondary'} fontSize={14} fontWeight={selected.includes(opt) ? '600' : '400'}>{opt}</B>
      </YStack>
    ))}
  </XStack>
);

// ─── Main Component ─────────────────────────────────────────

export default function SetupScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // All state (unchanged from previous version)
  const [authEmail, setAuthEmail] = useState(''); const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false); const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false); const [restoring, setRestoring] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false); const [stravaImporting, setStravaImporting] = useState(false);
  const [stravaImportStatus, setStravaImportStatus] = useState(''); const [stravaData, setStravaData] = useState<StravaProfileData | null>(null);
  const [name, setName] = useState(''); const [age, setAge] = useState('');
  const [gender, setGender] = useState<Gender>('Male'); const [raceDistance, setRaceDistance] = useState<RaceDistance>('10K');
  const [raceTime, setRaceTime] = useState(''); const [calculatedVDOT, setCalculatedVDOT] = useState<number | null>(null);
  const [weeklyMileage, setWeeklyMileage] = useState(''); const [longestRun, setLongestRun] = useState('');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('Intermediate'); const [weightKg, setWeightKg] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [stravaFilledFields, setStravaFilledFields] = useState<Set<string>>(new Set());
  const [raceName, setRaceName] = useState(''); const [raceDate, setRaceDate] = useState('');
  const [courseProfile, setCourseProfile] = useState<CourseProfile>('Unknown'); const [goalType, setGoalType] = useState<GoalType>('Time Goal');
  const [targetFinishTime, setTargetFinishTime] = useState('');
  const [availableDays, setAvailableDays] = useState<number[]>([1,2,3,4,5,6]); const [longRunDay, setLongRunDay] = useState(6);
  const [injuries, setInjuries] = useState<string[]>([]); const [weaknesses, setWeaknesses] = useState<string[]>([]);
  const [schedulingNotes, setSchedulingNotes] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false); const [showRaceTimePicker, setShowRaceTimePicker] = useState(false);
  const [showFinishTimePicker, setShowFinishTimePicker] = useState(false);
  const [pickerDuration, setPickerDuration] = useState(0); const [pickerSeconds, setPickerSeconds] = useState(0);
  const [planError, setPlanError] = useState<string | null>(null); const [planGenerating, setPlanGenerating] = useState(false);
  const [planSummary, setPlanSummary] = useState<{ totalWeeks: number; peakVolume: number; coachingNotes: string; keyPrinciples: string[]; warnings: string[] } | null>(null);

  // All callbacks (unchanged logic)
  useEffect(() => { const s = parseRaceTime(raceTime); if (!s||s<=0){setCalculatedVDOT(null);return;} let v:number; switch(raceDistance){case'5K':v=calculateVDOTFrom5K(s);break;case'10K':v=calculateVDOTFrom10K(s);break;case'Half Marathon':v=calculateVDOTFromHalf(s);break;default:v=calculateVDOTFrom10K(s);} setCalculatedVDOT(v); }, [raceTime,raceDistance]);

  useEffect(() => { try{const{isStravaConnected:c}=require('../src/strava/auth');if(c())setStravaConnected(true);}catch{} (async()=>{try{const{isLoggedIn:c}=require('../src/backup/auth');setIsLoggedIn(await c());}catch{}})(); }, []);

  const handleAuth = useCallback(async (mode:'signin'|'signup') => {
    if(!authEmail.trim()||!authPassword.trim()){setAuthError('Enter email and password.');return;} setAuthLoading(true);setAuthError(null);
    try{const{signIn,signUp}=require('../src/backup/auth');const r=mode==='signin'?await signIn(authEmail.trim(),authPassword.trim()):await signUp(authEmail.trim(),authPassword.trim());if(r.error){setAuthError(r.error);setAuthLoading(false);return;} setIsLoggedIn(true);setRestoring(true);const{downloadBackup,restoreDatabase}=require('../src/backup/backup');const b=await downloadBackup();if(b?.userProfile){const rr=await restoreDatabase(b);if(rr.success){await useAppStore.getState().initializeApp();router.replace('/(tabs)');return;}} setRestoring(false);setAuthLoading(false);setStep(2);}catch(e:any){setAuthError(e.message||'Failed.');setAuthLoading(false);setRestoring(false);}
  }, [authEmail,authPassword,router]);

  const handleConnectStrava = useCallback(async () => {
    setStravaImporting(true);setStravaImportStatus('Connecting...');
    try{const{connectStrava}=require('../src/strava/auth');const t=await connectStrava();if(!t){setStravaImporting(false);return;} setStravaConnected(true);const{importStravaProfile}=require('../src/strava/profileImport');const d:StravaProfileData=await importStravaProfile((s:string)=>setStravaImportStatus(s));setStravaData(d);const f=new Set<string>();if(d.name){setName(d.name);f.add('name');}if(d.gender){setGender(d.gender);f.add('gender');}if(d.weightKg){setWeightKg(String(Math.round(d.weightKg)));f.add('weight');}if(d.currentWeeklyMiles){setWeeklyMileage(String(d.currentWeeklyMiles));f.add('weeklyMileage');}if(d.longestRecentRun){setLongestRun(String(d.longestRecentRun));f.add('longestRun');}if(d.experienceLevel){setExperienceLevel(d.experienceLevel);f.add('experienceLevel');}if(d.bestEffortDistance){setRaceDistance(d.bestEffortDistance);f.add('raceDistance');}if(d.bestEffortTime){setRaceTime(d.bestEffortTime);f.add('raceTime');}if(d.calculatedVDOT){setCalculatedVDOT(d.calculatedVDOT);f.add('vdot');}setStravaFilledFields(f);setStravaImporting(false);setStep(3);}catch(e:any){Alert.alert('Error',e.message||'Failed');setStravaImporting(false);}
  }, []);

  const saveProfileAndGenerate = useCallback(() => {
    if(!calculatedVDOT)return;const gm:Record<GoalType,string>={'Just Finish':'finish','Time Goal':'time_goal','BQ':'bq','PR':'pr'};const cm:Record<CourseProfile,string>={'Flat':'flat','Rolling':'rolling','Hilly':'hilly','Unknown':'unknown'};const lm:Record<ExperienceLevel,string>={'Beginner':'beginner','Intermediate':'intermediate','Advanced':'advanced'};const gn:Record<Gender,string>={'Male':'male','Female':'female'};let ts:number|null=null;if((goalType==='Time Goal'||goalType==='BQ')&&targetFinishTime.trim())ts=parseRaceTime(targetFinishTime.trim());
    useAppStore.getState().saveProfile({name:name.trim()||null,age:Number(age),gender:gn[gender] as any,weight_kg:weightKg?Number(weightKg):null,height_cm:heightCm?Number(heightCm):null,vdot_score:calculatedVDOT,max_hr:null,rest_hr:null,current_weekly_miles:Number(weeklyMileage),longest_recent_run:Number(longestRun),experience_level:lm[experienceLevel] as any,race_date:raceDate.trim(),race_name:raceName.trim()||null,race_course_profile:cm[courseProfile] as any,race_goal_type:gm[goalType] as any,target_finish_time_sec:ts,injury_history:injuries.filter(i=>i!=='None'),known_weaknesses:weaknesses,scheduling_notes:schedulingNotes.trim()||null,available_days:availableDays,long_run_day:longRunDay});setStep(7);
  }, [calculatedVDOT,name,age,gender,weightKg,weeklyMileage,longestRun,experienceLevel,raceDate,raceName,courseProfile,goalType,targetFinishTime,availableDays,longRunDay,injuries,weaknesses,schedulingNotes]);

  const generatePlanRef = useRef(false);
  useEffect(() => { if(step!==7||generatePlanRef.current)return;generatePlanRef.current=true;setPlanGenerating(true);setPlanError(null);(async()=>{try{const r=await useAppStore.getState().generatePlan();if(r.success){const p=useAppStore.getState().activePlan;const w=useAppStore.getState().weeks;let cn='',kp:string[]=[],wa:string[]=[],pv=0;if(p){cn=p.coaching_notes||'';try{kp=p.key_principles?JSON.parse(p.key_principles):[];}catch{}try{wa=p.warnings?JSON.parse(p.warnings):[];}catch{}}if(w.length>0)pv=Math.max(...w.map(x=>x.target_volume));if(r.violations)wa=[...wa,r.violations];setPlanSummary({totalWeeks:w.length,peakVolume:Math.round(pv),coachingNotes:cn,keyPrinciples:kp,warnings:wa});setPlanGenerating(false);setStep(8);}else{setPlanError(r.error||'Error');setPlanGenerating(false);}}catch(e:any){setPlanError(e.message||'Failed');setPlanGenerating(false);}})(); }, [step]);

  const canAdvance = (): boolean => { switch(step){case 3:return age.trim()!==''&&!isNaN(Number(age))&&Number(age)>0&&raceTime.trim()!==''&&calculatedVDOT!==null&&weeklyMileage.trim()!==''&&longestRun.trim()!=='';case 4:return raceDate.trim()!==''&&/^\d{4}-\d{2}-\d{2}$/.test(raceDate.trim());case 5:return availableDays.length>=3&&availableDays.includes(longRunDay);default:return true;} };
  const handleNext = () => { if(step===6){saveProfileAndGenerate();return;} if(step<TOTAL_STEPS)setStep(step+1); };
  const handleBack = () => { if(step>1)setStep(step-1); };

  const toggleDay = (d:number) => { setAvailableDays(p=>p.includes(d)?p.filter(x=>x!==d):[...p,d]); if(availableDays.includes(d)&&longRunDay===d){const r=availableDays.filter(x=>x!==d);if(r.length>0)setLongRunDay(r[r.length-1]);} };
  const toggleInjury = (i:string) => { if(i==='None'){setInjuries(p=>p.includes('None')?[]:['None']);return;} setInjuries(p=>{const w=p.filter(x=>x!=='None');return w.includes(i)?w.filter(x=>x!==i):[...w,i];}); };
  const toggleWeakness = (w:string) => setWeaknesses(p=>p.includes(w)?p.filter(x=>x!==w):[...p,w]);

  const openDurationPicker = (cv:string, target:'race'|'finish') => { const s=parseRaceTime(cv);if(s&&s>0){setPickerDuration(Math.floor(s/60)*60);setPickerSeconds(s%60);}else{setPickerDuration(target==='finish'?3.5*3600:25*60);setPickerSeconds(0);} target==='race'?setShowRaceTimePicker(true):setShowFinishTimePicker(true); };
  const confirmDurationPicker = (target:'race'|'finish') => { const t=pickerDuration+pickerSeconds;if(t<=0)return;const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;const f=h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;target==='race'?(() => {setRaceTime(f);setShowRaceTimePicker(false);})():(() => {setTargetFinishTime(f);setShowFinishTimePicker(false);})(); };

  const SECONDS_OPTIONS = Array.from({length:60},(_,i)=>i);

  // Duration picker modal (keeps RN Modal + Pressable for touch handling)
  const DurationPickerModal = ({visible,onClose,onConfirm,title}:{visible:boolean;onClose:()=>void;onConfirm:()=>void;title:string}) => (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}} onPress={onClose}>
        <Pressable style={{backgroundColor:'#1E1E1E',borderTopLeftRadius:20,borderTopRightRadius:20,padding:24,paddingBottom:40}} onPress={e=>e.stopPropagation()}>
          <H color="$color" fontSize={22} textAlign="center" marginBottom="$5" letterSpacing={1}>{title}</H>
          <DateTimePicker value={new Date(2000,0,1,Math.floor(pickerDuration/3600),Math.floor((pickerDuration%3600)/60),0)} mode="countdown" display="spinner" minuteInterval={1} themeVariant="dark" onChange={(_,d)=>{if(d)setPickerDuration(d.getHours()*3600+d.getMinutes()*60);}} />
          <YStack marginTop="$1" marginBottom="$2">
            <H color="$textSecondary" fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom="$2" textAlign="center">Seconds</H>
            <RNScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:8,gap:6}}>
              {SECONDS_OPTIONS.map(sec=>(
                <Pressable key={sec} onPress={()=>setPickerSeconds(sec)} style={{width:40,height:36,borderRadius:8,backgroundColor:pickerSeconds===sec?'#FF6B35':'#2A2A2A',justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:pickerSeconds===sec?'#FF6B35':'#333'}}>
                  <M color={pickerSeconds===sec?'white':'$textSecondary'} fontSize={15} fontWeight="600">{String(sec).padStart(2,'0')}</M>
                </Pressable>
              ))}
            </RNScrollView>
          </YStack>
          <M color="$accent" fontSize={28} fontWeight="800" textAlign="center" marginTop="$2">
            {(()=>{const t=pickerDuration+pickerSeconds;const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;return h>0?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;})()}
          </M>
          <YStack backgroundColor="$accent" borderRadius="$5" paddingVertical="$3" alignItems="center" marginTop="$5" pressStyle={{opacity:0.8}} onPress={onConfirm}>
            <B color="white" fontSize={16} fontWeight="700">Confirm</B>
          </YStack>
        </Pressable>
      </Pressable>
    </Modal>
  );

  // ═══════════════════════════════════════════════════════════
  // STEP RENDERERS
  // ═══════════════════════════════════════════════════════════

  const renderStep1 = () => {
    if (restoring) return (
      <YStack flex={1} justifyContent="center" alignItems="center" paddingHorizontal="$8">
        <Spinner size="large" color="$accent" /><H color="$color" fontSize={28} letterSpacing={1} marginTop="$5">Restoring your data...</H>
        <B color="$textSecondary" fontSize={15} marginTop="$2">Downloading your plan and history from the cloud.</B>
      </YStack>
    );
    return (
      <ScrollView flex={1} contentContainerStyle={{paddingHorizontal:24,paddingTop:60,paddingBottom:32}}>
        <H color="$color" fontSize={36} letterSpacing={1} marginBottom="$2">Marathon Coach</H>
        <B color="$textSecondary" fontSize={15} lineHeight={22} marginBottom="$7">Sign in to restore your data, or create an account to get started.</B>
        {!isLoggedIn ? (<>
          <Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Email" placeholderTextColor="$textTertiary" value={authEmail} onChangeText={setAuthEmail} autoCapitalize="none" keyboardType="email-address" />
          <Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Password" placeholderTextColor="$textTertiary" secureTextEntry value={authPassword} onChangeText={setAuthPassword} marginTop="$3" />
          {authError && <B color="$danger" fontSize={13} marginTop="$2" textAlign="center">{authError}</B>}
          <YStack backgroundColor="$accent" borderRadius="$5" paddingVertical="$3" alignItems="center" marginTop="$4" opacity={authLoading?0.4:1} pressStyle={{opacity:0.8}} onPress={authLoading?undefined:()=>handleAuth('signin')}><B color="white" fontSize={16} fontWeight="700">{authLoading?'Signing in...':'Sign In & Restore'}</B></YStack>
          <YStack backgroundColor="$surface" borderRadius="$5" paddingVertical="$3" alignItems="center" marginTop="$3" borderWidth={1} borderColor="$border" opacity={authLoading?0.4:1} pressStyle={{opacity:0.8}} onPress={authLoading?undefined:()=>handleAuth('signup')}><B color="$textSecondary" fontSize={15} fontWeight="600">Create Account</B></YStack>
        </>) : (<XStack backgroundColor="$surface" borderRadius="$5" padding="$4" borderWidth={1} borderColor="$success" marginTop="$4" alignSelf="center" alignItems="center" gap="$3"><B color="$success" fontSize={20}>✓</B><B color="$success" fontSize={16} fontWeight="600">Signed in</B></XStack>)}
        <YStack marginTop="$6" padding="$3" alignItems="center" pressStyle={{opacity:0.7}} onPress={()=>setStep(2)}><B color="$textSecondary" fontSize={15} textDecorationLine="underline">Skip — continue without account</B></YStack>
      </ScrollView>
    );
  };

  const renderStep2 = () => {
    if (stravaImporting) return (
      <YStack flex={1} justifyContent="center" alignItems="center" paddingHorizontal="$8">
        <Spinner size="large" color="$accent" /><H color="$color" fontSize={28} letterSpacing={1} marginTop="$5">Importing your data</H>
        <B color="$textSecondary" fontSize={15} marginTop="$2">{stravaImportStatus}</B>
      </YStack>
    );
    return (
      <YStack flex={1} justifyContent="center" alignItems="center" paddingHorizontal="$8">
        <H color="$color" fontSize={32} letterSpacing={1} marginBottom="$2">Connect Strava</H>
        <B color="$textSecondary" fontSize={15} textAlign="center" lineHeight={22} marginBottom="$8">We'll import your running history to pre-fill your profile.</B>
        {stravaConnected ? (<XStack backgroundColor="$surface" borderRadius="$5" padding="$4" borderWidth={1} borderColor="$success" alignItems="center" gap="$3"><B color="$success" fontSize={20}>✓</B><B color="$success" fontSize={16} fontWeight="600">Strava connected</B></XStack>)
        : (<YStack backgroundColor="$strava" paddingVertical="$4" paddingHorizontal="$10" borderRadius="$5" width="100%" alignItems="center" pressStyle={{opacity:0.8}} onPress={handleConnectStrava}><B color="white" fontSize={18} fontWeight="700">Connect with Strava</B></YStack>)}
        <YStack marginTop="$6" padding="$3" pressStyle={{opacity:0.7}} onPress={()=>setStep(3)}><B color="$textSecondary" fontSize={15} textDecorationLine="underline">Skip — enter everything manually</B></YStack>
      </YStack>
    );
  };

  const renderStep3 = () => (
    <ScrollView flex={1} contentContainerStyle={{paddingHorizontal:24,paddingTop:8,paddingBottom:32}}>
      <H color="$color" fontSize={32} letterSpacing={1} marginBottom="$2">Your Profile</H>
      <B color="$textSecondary" fontSize={15} lineHeight={22} marginBottom="$7">{stravaData?'Pre-filled from Strava. Review and edit.':'Enter your details.'}</B>
      <FieldLabel text="Name" fromStrava={stravaFilledFields.has('name')} /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="Your name" placeholderTextColor="$textTertiary" value={name} onChangeText={setName} />
      <FieldLabel text="Age *" /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. 35" placeholderTextColor="$textTertiary" keyboardType="number-pad" value={age} onChangeText={setAge} />
      <FieldLabel text="Gender" fromStrava={stravaFilledFields.has('gender')} /><SegmentedControl options={GENDERS} selected={gender} onSelect={setGender} />
      <FieldLabel text="Height (cm)" /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. 175" placeholderTextColor="$textTertiary" keyboardType="number-pad" value={heightCm} onChangeText={setHeightCm} />
      <FieldLabel text="Recent Race Distance" fromStrava={stravaFilledFields.has('raceDistance')} /><SegmentedControl options={RACE_DISTANCES} selected={raceDistance} onSelect={setRaceDistance} />
      <FieldLabel text="Recent Race Time *" fromStrava={stravaFilledFields.has('raceTime')} />
      <YStack backgroundColor="$surface" borderRadius="$4" borderWidth={1} borderColor="$border" paddingHorizontal="$3" paddingVertical="$3" pressStyle={{opacity:0.8}} onPress={()=>openDurationPicker(raceTime,'race')}><B color={raceTime?'$color':'$textTertiary'} fontSize={16}>{raceTime||'Tap to set time'}</B></YStack>
      <DurationPickerModal visible={showRaceTimePicker} onClose={()=>setShowRaceTimePicker(false)} onConfirm={()=>confirmDurationPicker('race')} title={`${raceDistance} Time`} />
      {calculatedVDOT!==null&&(<YStack backgroundColor="$surface" borderRadius="$5" padding="$4" alignItems="center" marginTop="$4" borderWidth={1} borderColor="$accent"><H color="$textSecondary" fontSize={14} letterSpacing={1.5}>VDOT</H><M color="$accent" fontSize={48} fontWeight="800">{calculatedVDOT}</M></YStack>)}
      <FieldLabel text="Weekly Mileage *" fromStrava={stravaFilledFields.has('weeklyMileage')} /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. 25" placeholderTextColor="$textTertiary" keyboardType="decimal-pad" value={weeklyMileage} onChangeText={setWeeklyMileage} />
      <FieldLabel text="Longest Recent Run (mi) *" fromStrava={stravaFilledFields.has('longestRun')} /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. 10" placeholderTextColor="$textTertiary" keyboardType="decimal-pad" value={longestRun} onChangeText={setLongestRun} />
      <FieldLabel text="Experience" fromStrava={stravaFilledFields.has('experienceLevel')} /><SegmentedControl options={EXPERIENCE_LEVELS} selected={experienceLevel} onSelect={setExperienceLevel} />
      {stravaData&&(<YStack backgroundColor="$surface" borderRadius="$5" padding="$3" marginTop="$5" borderLeftWidth={3} borderLeftColor="$strava"><H color="$strava" fontSize={13} textTransform="uppercase" letterSpacing={1} marginBottom="$1">Strava Import</H><B color="$textSecondary" fontSize={13} lineHeight={19}>{stravaData.totalActivities} runs analyzed</B></YStack>)}
      <YStack height={20} />
    </ScrollView>
  );

  const renderStep4 = () => (
    <ScrollView flex={1} contentContainerStyle={{paddingHorizontal:24,paddingTop:8,paddingBottom:32}}>
      <H color="$color" fontSize={32} letterSpacing={1} marginBottom="$2">Race Details</H>
      <B color="$textSecondary" fontSize={15} lineHeight={22} marginBottom="$7">Tell us about your target marathon.</B>
      <FieldLabel text="Race Name (optional)" /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. Chicago Marathon" placeholderTextColor="$textTertiary" value={raceName} onChangeText={setRaceName} />
      <FieldLabel text="Race Date *" />
      <YStack backgroundColor="$surface" borderRadius="$4" borderWidth={1} borderColor="$border" paddingHorizontal="$3" paddingVertical="$3" pressStyle={{opacity:0.8}} onPress={()=>setShowDatePicker(true)}><B color={raceDate?'$color':'$textTertiary'} fontSize={16}>{raceDate||'Tap to select race date'}</B></YStack>
      {showDatePicker&&(<Modal visible transparent animationType="slide"><Pressable style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-end'}} onPress={()=>setShowDatePicker(false)}><Pressable style={{backgroundColor:'#1E1E1E',borderTopLeftRadius:20,borderTopRightRadius:20,padding:24,paddingBottom:40}} onPress={e=>e.stopPropagation()}><H color="$color" fontSize={22} textAlign="center" marginBottom="$5" letterSpacing={1}>Race Date</H><DateTimePicker value={raceDate?new Date(raceDate+'T00:00:00'):new Date(Date.now()+120*86400000)} mode="date" display="spinner" minimumDate={new Date()} themeVariant="dark" onChange={(_,d)=>{if(d){setRaceDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);}}} /><YStack backgroundColor="$accent" borderRadius="$5" paddingVertical="$3" alignItems="center" marginTop="$5" pressStyle={{opacity:0.8}} onPress={()=>setShowDatePicker(false)}><B color="white" fontSize={16} fontWeight="700">Done</B></YStack></Pressable></Pressable></Modal>)}
      <FieldLabel text="Course Profile" /><SegmentedControl options={COURSE_PROFILES} selected={courseProfile} onSelect={setCourseProfile} />
      <FieldLabel text="Goal Type" /><SegmentedControl options={GOAL_TYPES} selected={goalType} onSelect={setGoalType} />
      {(goalType==='Time Goal'||goalType==='BQ')&&(<><FieldLabel text="Target Finish Time" /><YStack backgroundColor="$surface" borderRadius="$4" borderWidth={1} borderColor="$border" paddingHorizontal="$3" paddingVertical="$3" pressStyle={{opacity:0.8}} onPress={()=>openDurationPicker(targetFinishTime,'finish')}><B color={targetFinishTime?'$color':'$textTertiary'} fontSize={16}>{targetFinishTime||'Tap to set (e.g. 3:30:00)'}</B></YStack><DurationPickerModal visible={showFinishTimePicker} onClose={()=>setShowFinishTimePicker(false)} onConfirm={()=>confirmDurationPicker('finish')} title="Target Finish Time" /></>)}
      <YStack height={20} />
    </ScrollView>
  );

  const renderStep5 = () => (
    <ScrollView flex={1} contentContainerStyle={{paddingHorizontal:24,paddingTop:8,paddingBottom:32}}>
      <H color="$color" fontSize={32} letterSpacing={1} marginBottom="$2">Training Schedule</H>
      <B color="$textSecondary" fontSize={15} lineHeight={22} marginBottom="$7">Which days can you run? Pick at least 3.</B>
      <FieldLabel text="Available Days" />
      <XStack flexWrap="wrap" gap="$2">{DAY_LABELS.map((l,i)=>(<YStack key={i} width={44} height={44} borderRadius={22} backgroundColor={availableDays.includes(i)?'$accent':'$surface'} borderWidth={1} borderColor={availableDays.includes(i)?'$accent':'$border'} justifyContent="center" alignItems="center" pressStyle={{opacity:0.8}} onPress={()=>toggleDay(i)}><B color={availableDays.includes(i)?'white':'$textSecondary'} fontSize={13} fontWeight="600">{l}</B></YStack>))}</XStack>
      <FieldLabel text="Long Run Day" /><B color="$textTertiary" fontSize={13} marginBottom="$2">Pick one of your available days.</B>
      <XStack flexWrap="wrap" gap="$2">{DAY_LABELS.map((l,i)=>{const a=availableDays.includes(i);return(<YStack key={i} width={44} height={44} borderRadius={22} backgroundColor={longRunDay===i?'$primary':a?'$surface':'$surface'} borderWidth={1} borderColor={longRunDay===i?'$primary':a?'$border':'$border'} opacity={a?1:0.3} justifyContent="center" alignItems="center" pressStyle={a?{opacity:0.8}:undefined} onPress={a?()=>setLongRunDay(i):undefined}><B color={longRunDay===i||a?'$color':'$textTertiary'} fontSize={13} fontWeight="600">{l}</B></YStack>);})}</XStack>
      <YStack height={20} />
    </ScrollView>
  );

  const renderStep6 = () => (
    <ScrollView flex={1} contentContainerStyle={{paddingHorizontal:24,paddingTop:8,paddingBottom:32}}>
      <H color="$color" fontSize={32} letterSpacing={1} marginBottom="$2">Coaching Context</H>
      <B color="$textSecondary" fontSize={15} lineHeight={22} marginBottom="$7">Everything here is optional — skip ahead if you want.</B>
      <FieldLabel text="Injury History" /><ChipSelect options={INJURIES} selected={injuries} onToggle={toggleInjury} />
      <FieldLabel text="Known Weaknesses" /><ChipSelect options={WEAKNESSES} selected={weaknesses} onToggle={toggleWeakness} />
      <FieldLabel text="Scheduling Notes" /><Input backgroundColor="$surface" borderColor="$border" color="$color" fontSize={16} fontFamily="$body" placeholder="e.g. Travel for work on Wednesdays..." placeholderTextColor="$textTertiary" multiline numberOfLines={3} value={schedulingNotes} onChangeText={setSchedulingNotes} minHeight={80} />
      <YStack height={20} />
    </ScrollView>
  );

  const renderStep7 = () => (
    <YStack flex={1}>
      <PlanGenerationLoader isActive={planGenerating} error={planError} />
      {planError&&(<YStack position="absolute" bottom={60} left={32} right={32} gap="$3">
        <YStack backgroundColor="$accent" borderRadius="$5" paddingVertical="$3" alignItems="center" pressStyle={{opacity:0.8}} onPress={()=>{generatePlanRef.current=false;setPlanSummary(null);setPlanError(null);setStep(7);}}><B color="white" fontSize={16} fontWeight="700">Try Again</B></YStack>
        <YStack padding="$3" alignItems="center" pressStyle={{opacity:0.7}} onPress={()=>{setStep(6);generatePlanRef.current=false;}}><B color="$textSecondary" fontSize={15} textDecorationLine="underline">Back to Edit</B></YStack>
      </YStack>)}
    </YStack>
  );

  const renderStep8 = () => (
    <ScrollView flex={1} contentContainerStyle={{paddingHorizontal:24,paddingTop:8,paddingBottom:32}}>
      <H color="$color" fontSize={32} letterSpacing={1} marginBottom="$4">Your Plan is Ready</H>
      {planSummary&&(<>
        <YStack backgroundColor="$surface" borderRadius="$5" padding="$5" marginBottom="$4">
          <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1"><B color="$textSecondary" fontSize={15}>Total Weeks</B><M color="$color" fontSize={24} fontWeight="700">{planSummary.totalWeeks}</M></XStack>
          <View height={1} backgroundColor="$border" marginVertical="$3" />
          <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1"><B color="$textSecondary" fontSize={15}>Peak Volume</B><M color="$color" fontSize={24} fontWeight="700">{planSummary.peakVolume} mi</M></XStack>
        </YStack>
        {planSummary.coachingNotes?<YStack backgroundColor="$surface" borderRadius="$5" padding="$4" marginBottom="$4"><H color="$color" fontSize={16} letterSpacing={1} marginBottom="$2">Coach Notes</H><B color="$textSecondary" fontSize={14} lineHeight={20}>{planSummary.coachingNotes}</B></YStack>:null}
        {planSummary.keyPrinciples.length>0&&<YStack backgroundColor="$surface" borderRadius="$5" padding="$4" marginBottom="$4"><H color="$color" fontSize={16} letterSpacing={1} marginBottom="$2">Key Principles</H>{planSummary.keyPrinciples.map((p,i)=><B key={i} color="$textSecondary" fontSize={14} lineHeight={22} paddingLeft="$1">{'\u2022'} {p}</B>)}</YStack>}
        {planSummary.warnings.length>0&&<YStack backgroundColor="$surface" borderRadius="$5" padding="$4" marginBottom="$4" borderWidth={1} borderColor="$warning"><H color="$warning" fontSize={16} letterSpacing={1} marginBottom="$2">Warnings</H>{planSummary.warnings.map((w,i)=><B key={i} color="$warning" fontSize={14} lineHeight={22}>{'\u26A0'} {w}</B>)}</YStack>}
      </>)}
      <YStack marginTop="$6" gap="$3">
        <YStack backgroundColor="$accent" borderRadius="$5" paddingVertical="$4" alignItems="center" pressStyle={{opacity:0.8}} onPress={()=>router.replace('/(tabs)')}><B color="white" fontSize={18} fontWeight="700">Start Training</B></YStack>
        <YStack backgroundColor="$surface" borderRadius="$5" paddingVertical="$3" alignItems="center" borderWidth={1} borderColor="$border" pressStyle={{opacity:0.8}} onPress={()=>{generatePlanRef.current=false;setPlanSummary(null);setPlanError(null);setStep(7);}}><B color="$textSecondary" fontSize={16} fontWeight="600">Regenerate Plan</B></YStack>
      </YStack>
      <YStack height={20} />
    </ScrollView>
  );

  const stepRenderers = [null, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6, renderStep7, renderStep8];
  const showNav = step >= 3 && step <= 6;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#121212' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Step indicator */}
      {step >= 1 && step <= 6 && (
        <XStack justifyContent="center" alignItems="center" paddingTop={60} paddingBottom="$3" gap="$2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View key={i} width={i+1===step?24:8} height={8} borderRadius="$1"
              backgroundColor={i+1===step?'$accent':i+1<step?'$accent':'$border'}
              opacity={i+1<step?0.5:1} />
          ))}
        </XStack>
      )}

      {stepRenderers[step]?.()}

      {/* Nav bar */}
      {showNav && (
        <XStack justifyContent="space-between" alignItems="center" paddingHorizontal="$6" paddingVertical="$4" paddingBottom={36} borderTopWidth={1} borderTopColor="$border">
          <YStack paddingVertical="$3" paddingHorizontal="$4" minWidth={80} pressStyle={{opacity:0.7}} onPress={handleBack}>
            <B color="$textSecondary" fontSize={16} fontWeight="500">Back</B>
          </YStack>
          <YStack backgroundColor="$accent" paddingVertical="$3" paddingHorizontal="$7" borderRadius="$4" minWidth={120} alignItems="center"
            opacity={canAdvance()?1:0.4} pressStyle={canAdvance()?{opacity:0.8}:undefined}
            onPress={canAdvance()?handleNext:undefined}>
            <B color="white" fontSize={16} fontWeight="700">{step===6?'Generate Plan':'Next'}</B>
          </YStack>
        </XStack>
      )}
    </KeyboardAvoidingView>
  );
}
