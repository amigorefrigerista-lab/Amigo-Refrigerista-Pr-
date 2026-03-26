'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  AlertCircle, 
  Calculator, 
  Users, 
  Search, 
  Cloud, 
  Sun,
  CloudRain,
  Wind,
  Bookmark, 
  FileText, 
  Zap, 
  Package,
  ChevronRight,
  Thermometer,
  Plus,
  ArrowRight,
  Calendar,
  MapPin,
  Menu,
  Bell,
  ArrowLeft,
  Phone,
  Mail,
  History,
  Settings,
  Info,
  Map as MapIcon,
  X,
  Eye,
  ChevronUp,
  CheckCircle,
  Clock,
  Filter,
  Loader2,
  LogOut
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Toaster, toast } from 'sonner';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, setDoc, updateDoc, onSnapshot, query, deleteDoc, getDoc, getDocs } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Provide user-facing feedback
  if (errorMessage.includes('permission-denied') || errorMessage.includes('Missing or insufficient permissions')) {
    toast.error('Você não tem permissão para realizar esta ação.');
  } else if (errorMessage.includes('offline')) {
    toast.error('Você está offline. Verifique sua conexão.');
  } else {
    toast.error('Ocorreu um erro ao comunicar com o servidor.');
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Dynamically import Leaflet components to avoid SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false });
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false });

// Fix Leaflet icon issue in React
import 'leaflet/dist/leaflet.css';

const MapWithMarker = ({ client }: { client: Client }) => {
  const [L, setL] = useState<any>(null);

  React.useEffect(() => {
    import('leaflet').then((leaflet) => {
      const DefaultIcon = leaflet.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });
      leaflet.Marker.prototype.options.icon = DefaultIcon;
      setL(leaflet);
    });
  }, []);

  if (!L) return <div className="h-full w-full bg-slate-900 animate-pulse flex items-center justify-center text-slate-500">Carregando mapa...</div>;

  return (
    <MapContainer 
      center={[client.lat, client.lng]} 
      zoom={15} 
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[client.lat, client.lng]}>
        <Popup>
          <div className="font-bold text-[#005bbf]">{client.name}</div>
          <div className="text-xs">{client.address}</div>
        </Popup>
      </Marker>
    </MapContainer>
  );
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Interfaces ---

interface ServiceRecord {
  date: string;
  description: string;
  status: 'Concluído' | 'Pendente' | 'Em andamento';
}

interface MaintenanceRecord {
  date: string;
  description: string;
  technician: string;
}

interface Equipment {
  brand: string;
  model: string;
  serial: string;
  installDate: string;
  installLocation: string;
  lastMaintenanceDate: string;
  maintenanceIntervalMonths: number;
  maintenanceHistory: MaintenanceRecord[];
  notes?: string[];
}

interface Client {
  id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  lat: number;
  lng: number;
  history: ServiceRecord[];
  equipment: Equipment[];
  notes: string[];
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: 'maintenance' | 'pending_call' | 'system';
  date: string;
  read: boolean;
  clientId?: string;
}

interface AppSettings {
  defaultMaintenanceInterval: number;
  notifications: {
    maintenanceAlerts: boolean;
    pendingCalls: boolean;
    newFeatures: boolean;
  };
}

const calculateNextMaintenance = (lastDate: string, intervalMonths: number) => {
  const [day, month, year] = lastDate.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  date.setMonth(date.getMonth() + intervalMonths);
  
  const now = new Date();
  const isOverdue = date < now;
  const isSoon = !isOverdue && (date.getTime() - now.getTime()) < (1000 * 60 * 60 * 24 * 30); // 30 days

  const nextDay = String(date.getDate()).padStart(2, '0');
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  const nextYear = date.getFullYear();
  
  return {
    date: `${nextDay}/${nextMonth}/${nextYear}`,
    isOverdue,
    isSoon
  };
};

const SuccessAnimation = ({ show, message }: { show: boolean, message: string }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -20 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] bg-[#005bbf] text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/20"
        >
          <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[#005bbf]">
            <CheckCircle size={16} />
          </div>
          <span className="text-xs font-black uppercase tracking-widest">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// --- Components ---

const BottomNav = ({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (tab: string) => void }) => {
  const tabs = [
    { id: 'dash', label: 'Início', icon: LayoutDashboard },
    { id: 'errors', label: 'Erros', icon: AlertCircle },
    { id: 'calc', label: 'Calc', icon: Calculator },
    { id: 'clients', label: 'Clientes', icon: Users },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-xl border-t border-white/10 pb-safe">
      <div className="max-w-lg mx-auto flex justify-around items-center h-14 px-2 sm:px-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "group relative flex-1 flex flex-col items-center justify-center h-full transition-all duration-200 active:scale-95",
                isActive ? "text-[#005bbf]" : "text-slate-500"
              )}
            >
              <div className={cn(
                "p-1 rounded-xl transition-all duration-300",
                isActive ? "bg-[#005bbf]/10" : "bg-transparent"
              )}>
                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={cn(
                "text-[8px] font-bold uppercase tracking-widest mt-1 transition-all duration-300",
                isActive ? "opacity-100" : "opacity-70"
              )}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const Header = ({ 
  onOpenNotifications, 
  onOpenSettings,
  unreadCount,
  user,
  onLogout
}: { 
  onOpenNotifications: () => void, 
  onOpenSettings: () => void,
  unreadCount: number,
  user: User,
  onLogout: () => void
}) => (
  <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/85 backdrop-blur-xl px-4 md:px-6 py-2 md:py-2.5 flex items-center justify-between">
    <div className="flex items-center gap-2">
      <div className="text-[#005bbf]">
        <Zap size={18} fill="currentColor" />
      </div>
      <h1 className="text-[#005bbf] font-black italic tracking-tighter text-sm md:text-base font-sans">Amigo Refrigerista Pro</h1>
    </div>
    <div className="flex items-center gap-2 md:gap-3">
      <div className="hidden md:flex items-center gap-5 mr-4">
        <span className="text-slate-600 font-bold text-xs cursor-pointer hover:opacity-70">Painel</span>
        <span className="text-[#005bbf] font-bold text-xs border-b-2 border-[#005bbf]">Erros</span>
        <span className="text-slate-600 font-bold text-xs cursor-pointer hover:opacity-70">Cálculos</span>
        <span className="text-slate-600 font-bold text-xs cursor-pointer hover:opacity-70">Clientes</span>
      </div>
      <button 
        onClick={onOpenNotifications}
        className="relative p-1.5 md:p-2 hover:bg-slate-800 rounded-full transition-colors group"
      >
        <Bell size={20} className="text-slate-300 group-hover:text-white transition-colors" />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-[#ba1a1a] text-white text-[9px] font-black flex items-center justify-center rounded-full border-2 border-[#0a0a0a] animate-bounce">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <button 
        onClick={onOpenSettings}
        className="p-1.5 md:p-2 hover:bg-slate-800 rounded-full transition-colors group"
      >
        <Settings size={20} className="text-slate-300 group-hover:text-white transition-colors" />
      </button>

      <div className="flex flex-col items-end mr-1">
        <span className="hidden sm:block text-[9px] font-bold uppercase tracking-widest text-[#005bbf] leading-none">{user.displayName?.split(' ')[0] || 'Técnico'}</span>
        <button onClick={onLogout} className="text-[9px] font-bold uppercase tracking-widest text-[#ba1a1a] hover:underline leading-none mt-0.5 py-0.5">Sair</button>
      </div>
      <div className="w-8 h-8 md:w-10 md:h-10 rounded-full border-2 border-[#005bbf]/20 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity relative">
        <Image 
          src={user.photoURL || "https://picsum.photos/seed/tech-avatar/100/100"} 
          alt="Avatar do Técnico" 
          fill
          className="object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  </header>
);

// --- Screens ---

const WeatherWidget = () => {
  const [weather, setWeather] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    const fetchWeather = async (lat: number, lon: number) => {
      try {
        const apiKey = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
        if (!apiKey) {
          // Fallback to mock data if no API key
          setWeather({
            temp: 24,
            condition: 'Ensolarado',
            city: 'São Paulo',
            humidity: 65,
            wind: 12,
            icon: 'Sun'
          });
          setLoading(false);
          return;
        }

        const response = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=pt_br&appid=${apiKey}`
        );
        const data = await response.json();

        if (response.ok) {
          setWeather({
            temp: Math.round(data.main.temp),
            condition: data.weather[0].description,
            city: data.name,
            humidity: data.main.humidity,
            wind: Math.round(data.wind.speed * 3.6), // m/s to km/h
            icon: data.weather[0].main
          });
        } else {
          throw new Error(data.message);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          fetchWeather(position.coords.latitude, position.coords.longitude);
        },
        () => {
          // Default to a city if geolocation fails
          fetchWeather(-23.5505, -46.6333); // São Paulo
        }
      );
    } else {
      fetchWeather(-23.5505, -46.6333);
    }
  }, []);

  if (loading) return (
    <div className="bg-[#1a1a1a] rounded-2xl p-6 h-32 animate-pulse flex items-center justify-center">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-slate-800 rounded-full"></div>
        <div className="space-y-2">
          <div className="w-24 h-4 bg-slate-800 rounded"></div>
          <div className="w-16 h-3 bg-slate-800 rounded"></div>
        </div>
      </div>
    </div>
  );

  if (error && !weather) return null;

  const WeatherIcon = () => {
    switch (weather.icon) {
      case 'Clear': return <Sun className="text-amber-500" size={24} />;
      case 'Clouds': return <Cloud className="text-slate-400" size={24} />;
      case 'Rain': return <CloudRain className="text-blue-400" size={24} />;
      default: return <Sun className="text-amber-500" size={24} />;
    }
  };

  return (
    <section>
      <div className="bg-[#1a1a1a] rounded-xl p-3 shadow-sm border border-white/10 flex items-center justify-between overflow-hidden relative group">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#005bbf]/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-[#005bbf]/10 transition-colors"></div>
        
        <div className="flex items-center gap-3 relative z-10">
          <div className="p-2 bg-slate-900 rounded-xl">
            <WeatherIcon />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black text-slate-100">{weather.temp}°C</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{weather.condition}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-500 text-[10px] font-medium mt-0.5">
              <MapPin size={10} />
              <span>{weather.city}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-4 relative z-10">
          <div className="text-center">
            <div className="flex items-center gap-1 text-[#005bbf] mb-0.5">
              <Thermometer size={12} />
              <span className="text-[9px] font-black uppercase tracking-widest">{weather.humidity}%</span>
            </div>
            <p className="text-[7px] font-bold text-slate-400 uppercase tracking-tighter">Umidade</p>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-[#005bbf] mb-0.5">
              <Wind size={12} />
              <span className="text-[9px] font-black uppercase tracking-widest">{weather.wind} km/h</span>
            </div>
            <p className="text-[7px] font-bold text-slate-400 uppercase tracking-tighter">Vento</p>
          </div>
        </div>
      </div>
    </section>
  );
};

const DashboardScreen = ({ clients, onSelectClient }: { clients: Client[], onSelectClient: (client: Client) => void }) => {
  const stats = [
    { label: 'Trabalhos Hoje', value: '04', color: 'text-[#005bbf]' },
    { label: 'Eficiência', value: '94%', color: 'text-[#005bbf]' },
    { label: 'Horas', value: '6.5', color: 'text-[#005bbf]' },
    { label: 'Alertas', value: '02', color: 'text-[#9e4300]' },
  ];

  const tools = [
    { id: 'errors', title: 'Códigos de Erro', desc: 'Base de Dados de Diagnóstico HVAC', icon: AlertCircle, bg: 'bg-[#ba1a1a]/10', iconColor: 'text-[#ba1a1a]' },
    { id: 'thermal', title: 'Cálculo Térmico', desc: 'Análise de Carga Térmica e BTU', icon: Thermometer, bg: 'bg-[#005bbf]/10', iconColor: 'text-[#005bbf]' },
    { id: 'electrical', title: 'Cálculo Elétrico', desc: 'Dimensionamento de Fiação e Amperagem', icon: Zap, bg: 'bg-[#9e4300]/10', iconColor: 'text-[#9e4300]' },
    { id: 'orders', title: 'Ordens de Serviço', desc: 'Registros e Ordens de Serviço', icon: FileText, bg: 'bg-[#2b5bb5]/10', iconColor: 'text-[#2b5bb5]' },
  ];

  const upcomingMaintenance = React.useMemo(() => {
    const list: { client: Client, equipment: Equipment, nextMaint: any }[] = [];
    clients.forEach(client => {
      client.equipment.forEach(eq => {
        const nextMaint = calculateNextMaintenance(eq.lastMaintenanceDate, eq.maintenanceIntervalMonths);
        if (nextMaint.isSoon || nextMaint.isOverdue) {
          list.push({ client, equipment: eq, nextMaint });
        }
      });
    });
    return list.sort((a, b) => {
      const [da, ma, ya] = a.nextMaint.date.split('/').map(Number);
      const [db, mb, yb] = b.nextMaint.date.split('/').map(Number);
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime();
    });
  }, [clients]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <section>
        <p className="text-slate-500 font-bold text-[9px] uppercase tracking-widest mb-0.5">Bem-vindo de volta, Técnico</p>
        <h2 className="text-lg md:text-xl font-black tracking-tight text-slate-100">Visão Geral do Sistema</h2>
      </section>

      <WeatherWidget />

      {upcomingMaintenance.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 ml-1">
            <Calendar size={14} className="text-slate-400" />
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Próximas Manutenções (30 dias)</h3>
          </div>
          <div className="space-y-2">
            {upcomingMaintenance.slice(0, 3).map((item, i) => (
              <div 
                key={i}
                onClick={() => onSelectClient(item.client)}
                className="bg-[#1a1a1a] p-3.5 rounded-xl border-l-4 border-[#005bbf] flex items-center justify-between shadow-sm hover:bg-[#2a2a2a] transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-1.5 rounded-lg",
                    item.nextMaint.isOverdue ? "bg-[#ba1a1a]/10 text-[#ba1a1a]" : "bg-[#005bbf]/10 text-[#005bbf]"
                  )}>
                    <Package size={16} />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 group-hover:text-[#005bbf] transition-colors">{item.client.name}</h4>
                    <p className="text-[9px] text-slate-500 font-medium">{item.equipment.model} • {item.equipment.installLocation}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn(
                    "text-[9px] font-black uppercase tracking-widest",
                    item.nextMaint.isOverdue ? "text-[#ba1a1a]" : "text-[#005bbf]"
                  )}>
                    {item.nextMaint.date}
                  </p>
                  <p className="text-[7px] text-slate-500 font-bold uppercase tracking-tighter">
                    {item.nextMaint.isOverdue ? 'Atrasado' : 'Agendado'}
                  </p>
                </div>
              </div>
            ))}
            {upcomingMaintenance.length > 3 && (
              <p className="text-center text-[9px] font-bold text-slate-500 uppercase tracking-widest pt-1">
                + {upcomingMaintenance.length - 3} outras manutenções pendentes
              </p>
            )}
          </div>
        </section>
      )}

      <section>
        <div className="bg-[#1a1a1a] rounded-xl p-4 border-l-4 border-[#005bbf] flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="bg-[#005bbf]/10 p-2 rounded-lg text-[#005bbf]">
              <Calendar size={18} />
            </div>
            <div>
              <h3 className="text-[8px] font-black uppercase tracking-wider text-[#005bbf] mb-0.5">Próxima Manutenção</h3>
              <p className="text-sm font-bold text-slate-100">Precision Logistics Hub</p>
              <p className="text-[10px] text-slate-500 font-medium">Agendado: 24 Out, 2023 • 09:00</p>
            </div>
          </div>
          <button className="bg-[#759efd] text-[#00337c] px-4 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:opacity-90 active:scale-95 transition-all">
            Ver Rota
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tools.map((tool) => (
          <div 
            key={tool.id}
            className="group bg-[#1a1a1a] hover:bg-[#2a2a2a] p-4 rounded-xl transition-all duration-200 cursor-pointer h-32 flex flex-col justify-between shadow-sm"
          >
            <div className="flex justify-between items-start">
              <div className={cn("p-2 rounded-lg", tool.bg, tool.iconColor)}>
                <tool.icon size={18} />
              </div>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-[#005bbf] transition-colors" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{tool.title}</h3>
              <p className="text-slate-500 text-[10px]">{tool.desc}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[#2a2a2a] p-3 rounded-xl">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-0.5">{stat.label}</p>
            <p className={cn("text-base font-black", stat.color)}>{stat.value}</p>
          </div>
        ))}
      </section>

      <button className="fixed bottom-24 right-4 md:right-8 w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-[#005bbf] to-[#1a73e8] text-white rounded-full shadow-lg shadow-[#005bbf]/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-200 z-40">
        <Plus size={24} />
      </button>
    </motion.div>
  );
};

const ThermalCalculator = () => {
  const [area, setArea] = useState<number>(0);
  const [people, setPeople] = useState<number>(1);
  const [electronics, setElectronics] = useState<number>(0);
  const [sunExposure, setSunExposure] = useState<boolean>(false);

  const btuResult = React.useMemo(() => {
    if (area <= 0) return 0;
    const factor = sunExposure ? 800 : 600;
    const base = area * factor;
    const peopleBtu = (people > 1 ? (people - 1) * 600 : 0);
    const electronicsBtu = electronics * 600;
    return base + peopleBtu + electronicsBtu;
  }, [area, people, electronics, sunExposure]);

  const suggestedCapacity = React.useMemo(() => {
    if (btuResult === 0) return '---';
    if (btuResult <= 9000) return '9.000 BTU/h';
    if (btuResult <= 12000) return '12.000 BTU/h';
    if (btuResult <= 18000) return '18.000 BTU/h';
    if (btuResult <= 24000) return '24.000 BTU/h';
    if (btuResult <= 30000) return '30.000 BTU/h';
    if (btuResult <= 36000) return '36.000 BTU/h';
    if (btuResult <= 48000) return '48.000 BTU/h';
    if (btuResult <= 60000) return '60.000 BTU/h';
    return 'Acima de 60.000 BTU/h';
  }, [btuResult]);

  return (
    <div className="space-y-4">
      <div className="bg-[#1a1a1a] p-4 rounded-xl border border-white/10 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Área (m²)</label>
            <input 
              type="number" 
              value={area || ''} 
              onChange={(e) => setArea(parseFloat(e.target.value) || 0)}
              className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100"
              placeholder="Ex: 20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Pessoas</label>
            <input 
              type="number" 
              value={people || ''} 
              onChange={(e) => setPeople(parseInt(e.target.value) || 0)}
              className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100"
              placeholder="Ex: 2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Eletrônicos</label>
            <input 
              type="number" 
              value={electronics || ''} 
              onChange={(e) => setElectronics(parseInt(e.target.value) || 0)}
              className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100"
              placeholder="Ex: 1"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Exposição ao Sol</label>
            <button 
              onClick={() => setSunExposure(!sunExposure)}
              className={cn(
                "w-full h-10 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border",
                sunExposure ? "bg-[#005bbf] text-white border-[#005bbf]" : "bg-[#2a2a2a] text-slate-400 border-transparent"
              )}
            >
              {sunExposure ? 'Sim (Tarde/Manhã)' : 'Não'}
            </button>
          </div>
        </div>
      </div>

      {btuResult > 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-[#005bbf]/10 border border-[#005bbf]/30 p-4 rounded-xl text-center space-y-2"
        >
          <p className="text-[9px] font-black text-[#005bbf] uppercase tracking-[0.2em]">Carga Térmica Estimada</p>
          <h3 className="text-2xl font-black text-slate-100">{btuResult.toLocaleString()} <span className="text-sm font-bold text-slate-400">BTU/h</span></h3>
          <div className="pt-2 border-t border-[#005bbf]/20">
            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mb-1">Capacidade Sugerida</p>
            <p className="text-sm font-black text-[#005bbf]">{suggestedCapacity}</p>
          </div>
        </motion.div>
      )}

      <div className="bg-[#1a1a1a] p-3 rounded-xl border border-white/5">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-slate-500 mt-0.5" />
          <p className="text-[9px] text-slate-500 leading-relaxed">
            * O cálculo baseia-se em normas técnicas simplificadas (600-800 BTU/m²). Para projetos complexos ou comerciais, consulte um engenheiro termista.
          </p>
        </div>
      </div>
    </div>
  );
};

const ErrorCodesScreen = () => {
  const [activeMode, setActiveMode] = useState<'codes' | 'thermal'>('codes');
  const brands = ['LG', 'Samsung', 'Carrier', 'Gree', 'Daikin'];
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="pl-1">
            <h2 className="text-xl font-black text-slate-100 tracking-tight leading-none mb-1">
              {activeMode === 'codes' ? 'Códigos de Erro' : 'Calculadora Térmica'}
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#005bbf]/10 rounded-full">
                {activeMode === 'codes' ? (
                  <>
                    <Cloud size={12} className="text-[#005bbf]" />
                    <span className="text-[9px] font-bold text-[#005bbf] uppercase tracking-wider">Banco de dados sincronizado offline</span>
                  </>
                ) : (
                  <>
                    <Calculator size={12} className="text-[#005bbf]" />
                    <span className="text-[9px] font-bold text-[#005bbf] uppercase tracking-wider">Cálculo de Carga Térmica</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex bg-[#1a1a1a] p-1 rounded-lg border border-white/10">
            <button 
              onClick={() => setActiveMode('codes')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                activeMode === 'codes' ? "bg-[#005bbf] text-white" : "text-slate-500 hover:text-slate-300"
              )}
            >
              <AlertCircle size={16} />
            </button>
            <button 
              onClick={() => setActiveMode('thermal')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                activeMode === 'thermal' ? "bg-[#005bbf] text-white" : "text-slate-500 hover:text-slate-300"
              )}
            >
              <Calculator size={16} />
            </button>
          </div>
        </div>

        {activeMode === 'codes' ? (
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-400">
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder="Marca e Código (ex: LG CH 05)"
              className="w-full h-12 pl-12 pr-4 bg-[#2a2a2a] border-none rounded-xl text-slate-100 text-sm font-semibold focus:ring-2 focus:ring-[#005bbf]/40 transition-all placeholder:text-slate-500 shadow-sm"
            />
          </div>
        ) : (
          <ThermalCalculator />
        )}
      </section>

      {activeMode === 'codes' && (
        <>
          <section>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Marcas Populares</p>
            <div className="flex flex-wrap gap-2">
              {brands.map((brand, i) => (
                <button 
                  key={brand}
                  className={cn(
                    "px-4 py-2 rounded-lg font-bold text-xs transition-all active:scale-95",
                    i === 0 ? "bg-[#005bbf] text-white shadow-lg shadow-[#005bbf]/20" : "bg-[#2a2a2a] text-slate-300 hover:bg-[#3a3a3a]"
                  )}
                >
                  {brand}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Resultado da Busca</p>
            <div className="bg-[#1a1a1a] p-4 rounded-xl shadow-sm relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-[#005bbf]/5 rounded-full -mr-12 -mt-12 blur-3xl group-hover:bg-[#005bbf]/10 transition-colors"></div>
              
              <div className="flex items-center justify-between relative z-10 mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-[#005bbf]/20 text-[#759efd] font-black text-[9px] rounded-md uppercase tracking-widest">Código: CH 05</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ba1a1a] animate-pulse"></span>
                </div>
                <Bookmark size={16} className="text-slate-300" />
              </div>

              <div className="relative z-10 mb-4">
                <h3 className="text-lg font-black text-slate-100 tracking-tight mb-0.5">Erro de Comunicação</h3>
                <p className="text-slate-500 font-medium text-[10px] leading-tight">Verifique a conexão do cabo ODU/IDU e os blocos de terminais.</p>
              </div>

              <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-3 relative z-10 mb-4">
                <div className="bg-[#2a2a2a] p-2.5 rounded-lg">
                  <span className="block text-[8px] font-bold text-slate-500 uppercase mb-0.5">Causa Provável</span>
                  <p className="text-xs font-bold text-slate-100">Fiação Defeituosa</p>
                </div>
                <div className="bg-[#2a2a2a] p-2.5 rounded-lg">
                  <span className="block text-[8px] font-bold text-slate-500 uppercase mb-0.5">Taxa de Sucesso</span>
                  <p className="text-xs font-bold text-[#005bbf]">84% de Resolução</p>
                </div>
              </div>

              <button className="w-full h-11 bg-gradient-to-br from-[#005bbf] to-[#1a73e8] text-white font-bold text-xs rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-[#005bbf]/25 active:scale-[0.98] transition-all">
                <FileText size={14} />
                Ver Manual de Serviço Completo
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#ffdbcb] text-[#341100] p-4 rounded-xl flex items-center gap-3">
              <div className="bg-[#c55500]/20 p-2 rounded-full text-[#c55500]">
                <Zap size={18} />
              </div>
              <div>
                <h4 className="font-black text-xs tracking-tight">Verificação de Voltagem Necessária</h4>
                <p className="text-[10px] font-medium opacity-80">Teste DC 12-24V na Linha de Sinal</p>
              </div>
            </div>
            <div className="bg-[#d9e2ff] text-[#001945] p-4 rounded-xl flex items-center gap-3">
              <div className="bg-[#759efd]/20 p-2 rounded-full text-[#2b5bb5]">
                <Package size={18} />
              </div>
              <div>
                <h4 className="font-black text-xs tracking-tight">Disponibilidade de Peças</h4>
                <p className="text-[10px] font-medium opacity-80">Módulo PCB (IDU Principal) em estoque</p>
              </div>
            </div>
          </section>
        </>
      )}
    </motion.div>
  );
};

// --- Clients Data & Screens ---

const SettingsScreen = ({ 
  settings, 
  onUpdateSettings,
  isSaving
}: { 
  settings: AppSettings, 
  onUpdateSettings: (settings: AppSettings) => void,
  isSaving: boolean
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <section>
        <h2 className="text-lg font-black tracking-tight text-slate-100 mb-1">Configurações</h2>
        <p className="text-slate-500 text-[9px] font-medium">Personalize o comportamento do aplicativo.</p>
      </section>

      <section className="bg-[#1a1a1a] p-4 rounded-xl border border-white/5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 bg-[#005bbf]/20 rounded-lg text-[#005bbf]">
            <Calendar size={16} />
          </div>
          <h3 className="font-bold text-slate-100 text-xs">Manutenção Preventiva</h3>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-slate-300">Intervalo Padrão (Meses)</label>
            <p className="text-[9px] text-slate-500 leading-relaxed">
              Define o intervalo de tempo sugerido para a próxima manutenção ao cadastrar um novo equipamento.
            </p>
            <div className="flex items-center gap-3 mt-1">
              <input 
                type="range" 
                min="1" 
                max="24" 
                value={settings.defaultMaintenanceInterval}
                onChange={(e) => onUpdateSettings({ ...settings, defaultMaintenanceInterval: parseInt(e.target.value) })}
                className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#005bbf]"
              />
              <span className="w-10 text-center font-black text-[10px] text-[#005bbf] bg-[#005bbf]/10 py-0.5 rounded-md">
                {settings.defaultMaintenanceInterval}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#1a1a1a] p-4 rounded-xl border border-white/5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 bg-[#005bbf]/20 rounded-lg text-[#005bbf]">
            <Bell size={16} />
          </div>
          <h3 className="font-bold text-slate-100 text-xs">Preferências de Notificação</h3>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-[10px] font-bold text-slate-300">Alertas de Manutenção</label>
              <p className="text-[8px] text-slate-500">Notificar quando equipamentos precisarem de revisão.</p>
            </div>
            <button 
              onClick={() => onUpdateSettings({
                ...settings,
                notifications: { ...settings.notifications, maintenanceAlerts: !settings.notifications.maintenanceAlerts }
              })}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                settings.notifications.maintenanceAlerts ? "bg-[#005bbf]" : "bg-slate-700"
              )}
            >
              <motion.div 
                animate={{ x: settings.notifications.maintenanceAlerts ? 22 : 2 }}
                className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-[10px] font-bold text-slate-300">Chamados Pendentes</label>
              <p className="text-[8px] text-slate-500">Alertar sobre chamados que ainda não foram atendidos.</p>
            </div>
            <button 
              onClick={() => onUpdateSettings({
                ...settings,
                notifications: { ...settings.notifications, pendingCalls: !settings.notifications.pendingCalls }
              })}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                settings.notifications.pendingCalls ? "bg-[#005bbf]" : "bg-slate-700"
              )}
            >
              <motion.div 
                animate={{ x: settings.notifications.pendingCalls ? 22 : 2 }}
                className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-[10px] font-bold text-slate-300">Novidades e Atualizações</label>
              <p className="text-[8px] text-slate-500">Receber avisos sobre novos recursos no app.</p>
            </div>
            <button 
              onClick={() => onUpdateSettings({
                ...settings,
                notifications: { ...settings.notifications, newFeatures: !settings.notifications.newFeatures }
              })}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                settings.notifications.newFeatures ? "bg-[#005bbf]" : "bg-slate-700"
              )}
            >
              <motion.div 
                animate={{ x: settings.notifications.newFeatures ? 22 : 2 }}
                className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
              />
            </button>
          </div>
        </div>
      </section>

      <section className="bg-[#1a1a1a] p-4 rounded-xl border border-white/5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-500">
            <Info size={16} />
          </div>
          <h3 className="font-bold text-slate-100 text-xs">Sobre o App</h3>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">Versão</span>
            <span className="text-slate-300 font-mono">1.2.0-pro</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">Licença</span>
            <span className="text-emerald-500 font-bold">Ativa (Premium)</span>
          </div>
        </div>
      </section>
    </motion.div>
  );
};

const NotificationCenter = ({ 
  notifications, 
  onClose, 
  onMarkAsRead, 
  onSelectClient 
}: { 
  notifications: AppNotification[], 
  onClose: () => void,
  onMarkAsRead: (id: string) => void,
  onSelectClient: (clientId: string) => void
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className="fixed top-0 right-0 h-full w-full max-w-[280px] bg-[#1a1a1a] z-[100] shadow-2xl border-l border-white/10 flex flex-col"
    >
      <div className="p-4 border-b border-white/10 flex justify-between items-center bg-[#0a0a0a]">
        <h3 className="text-sm font-black text-slate-100 flex items-center gap-2">
          <Bell size={14} className="text-[#005bbf]" />
          Notificações
        </h3>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-full transition-colors">
          <X size={16} className="text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {notifications.length > 0 ? (
          notifications.map((notif) => (
            <div 
              key={notif.id}
              onClick={() => {
                if (notif.clientId) onSelectClient(notif.clientId);
                onMarkAsRead(notif.id);
              }}
              className={cn(
                "p-3 rounded-xl border transition-all cursor-pointer relative group",
                notif.read ? "bg-[#1a1a1a] border-white/5 opacity-60" : "bg-[#2a2a2a] border-[#005bbf]/30 shadow-lg"
              )}
            >
              {!notif.read && <div className="absolute top-3 right-3 w-1.5 h-1.5 bg-[#005bbf] rounded-full animate-pulse" />}
              <div className="flex items-start gap-2">
                <div className={cn(
                  "p-1.5 rounded-lg",
                  notif.type === 'maintenance' ? "bg-orange-500/20 text-orange-500" : 
                  notif.type === 'pending_call' ? "bg-red-500/20 text-red-500" : "bg-blue-500/20 text-blue-500"
                )}>
                  {notif.type === 'maintenance' ? <Calendar size={14} /> : 
                   notif.type === 'pending_call' ? <AlertCircle size={14} /> : <Info size={14} />}
                </div>
                <div className="space-y-0.5">
                  <h4 className="font-bold text-slate-100 text-xs">{notif.title}</h4>
                  <p className="text-[10px] text-slate-400 leading-tight">{notif.message}</p>
                  <span className="text-[8px] text-slate-500 font-medium">{notif.date}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="w-12 h-12 bg-slate-900 rounded-full flex items-center justify-center text-slate-600">
              <Bell size={24} />
            </div>
            <div>
              <p className="text-slate-100 font-bold text-xs">Tudo em dia!</p>
              <p className="text-slate-500 text-[10px]">Você não tem novas notificações no momento.</p>
            </div>
          </div>
        )}
      </div>

      {notifications.some(n => !n.read) && (
        <div className="p-3 border-t border-white/10">
          <button 
            onClick={() => notifications.forEach(n => onMarkAsRead(n.id))}
            className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-slate-100 transition-colors uppercase tracking-widest"
          >
            Marcar todas como lidas
          </button>
        </div>
      )}
    </motion.div>
  );
};

const ClientsScreen = ({ 
  clients, 
  onSelectClient, 
  onAddClient,
  isSaving
}: { 
  clients: Client[], 
  onSelectClient: (client: Client) => void,
  onAddClient: (client: Omit<Client, 'id' | 'history' | 'equipment' | 'notes'> & { notes?: string }) => void,
  isSaving: boolean
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newClient, setNewClient] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    lat: 0,
    lng: 0,
    notes: ''
  });

  const filteredClients = clients.filter(client => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      client.name.toLowerCase().includes(query) ||
      client.address.toLowerCase().includes(query) ||
      client.phone.toLowerCase().includes(query) ||
      client.email.toLowerCase().includes(query)
    );

    if (!matchesSearch) return false;

    if (statusFilter === 'Todos') return true;

    // Check if client has any history record matching the selected status
    return client.history.some(record => record.status === statusFilter);
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddClient(newClient);
    setIsModalOpen(false);
    setNewClient({ name: '', address: '', phone: '', email: '', lat: 0, lng: 0, notes: '' });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-5 relative min-h-[60vh]"
    >
      <section>
        <h2 className="text-xl font-black tracking-tight text-slate-100 mb-1">Clientes</h2>
        <p className="text-[10px] text-slate-500 font-medium">Gerencie sua base de clientes e históricos.</p>
      </section>

      <section className="relative group">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-400">
          <Search size={18} />
        </div>
        <input 
          type="text" 
          placeholder="Buscar por nome, endereço, tel ou email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-11 pl-12 pr-4 bg-[#2a2a2a] border-none rounded-xl text-slate-100 text-sm font-medium focus:ring-2 focus:ring-[#005bbf]/40 transition-all placeholder:text-slate-500"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-slate-400 px-1">
          <Filter size={12} />
          <span className="text-[9px] font-black uppercase tracking-widest">Filtrar por Status do Chamado</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
          {['Todos', 'Concluído', 'Em andamento', 'Pendente'].map((status) => {
            const count = status === 'Todos' ? clients.length : clients.filter(c => c.history.some(h => h.status === status)).length;
            const Icon = status === 'Concluído' ? CheckCircle : 
                         status === 'Em andamento' ? Clock : 
                         status === 'Pendente' ? AlertCircle : Filter;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-4 h-8 rounded-full text-[10px] font-bold whitespace-nowrap transition-all border flex items-center gap-1.5",
                  statusFilter === status 
                    ? "bg-[#005bbf] text-white border-[#005bbf] shadow-lg shadow-[#005bbf]/20" 
                    : "bg-[#1a1a1a] text-slate-400 border-white/10 hover:bg-[#2a2a2a] hover:text-slate-200"
                )}
              >
                {status !== 'Todos' && <Icon size={12} />}
                {status}
                <span className={cn(
                  "ml-0.5 px-1 py-0.5 rounded-full text-[8px]",
                  statusFilter === status ? "bg-white/20 text-white" : "bg-white/5 text-slate-500"
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        {filteredClients.length > 0 ? (
          filteredClients.map((client) => (
            <div 
              key={client.id}
              onClick={() => onSelectClient(client)}
              className="bg-[#1a1a1a] p-3.5 rounded-xl shadow-sm hover:bg-[#2a2a2a] transition-all cursor-pointer group flex items-center justify-between border-l-4 border-transparent hover:border-[#005bbf]"
            >
              <div className="space-y-0.5">
                <h3 className="font-bold text-slate-100 text-sm group-hover:text-[#005bbf] transition-colors">{client.name}</h3>
                <div className="flex items-center gap-2 text-slate-500 text-[10px]">
                  <MapPin size={10} />
                  <span>{client.address}</span>
                </div>
              </div>
              <ChevronRight size={16} className="text-slate-300 group-hover:text-[#005bbf] transition-colors" />
            </div>
          ))
        ) : (
          <div className="text-center py-8 bg-[#1a1a1a] rounded-xl border border-dashed border-white/10">
            <p className="text-slate-400 text-xs font-bold italic">Nenhum cliente encontrado para &quot;{searchQuery}&quot;</p>
          </div>
        )}
      </section>

      {/* Floating Action Button */}
      <button 
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-24 right-4 md:right-8 w-12 h-12 md:w-14 md:h-14 bg-[#005bbf] text-white rounded-full shadow-2xl shadow-[#005bbf]/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-40"
      >
        <Plus size={24} />
      </button>

      {/* New Client Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-[#1a1a1a] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center bg-[#1a1a1a] shrink-0">
                <h3 className="text-base font-black text-slate-100">Novo Cliente</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-1.5 hover:bg-slate-800 rounded-full transition-colors">
                  <X size={16} className="text-slate-400" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
                <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome do Cliente</label>
                    <input 
                      required
                      disabled={isSaving}
                      type="text" 
                      value={newClient.name}
                      onChange={(e) => setNewClient({...newClient, name: e.target.value})}
                      className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                      placeholder="Ex: Condomínio Vila Verde"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Endereço Completo</label>
                    <input 
                      required
                      disabled={isSaving}
                      type="text" 
                      value={newClient.address}
                      onChange={(e) => setNewClient({...newClient, address: e.target.value})}
                      className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                      placeholder="Rua, Número, Bairro, Cidade"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Telefone</label>
                      <input 
                        required
                        disabled={isSaving}
                        type="tel" 
                        value={newClient.phone}
                        onChange={(e) => setNewClient({...newClient, phone: e.target.value})}
                        className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail</label>
                      <input 
                        required
                        disabled={isSaving}
                        type="email" 
                        value={newClient.email}
                        onChange={(e) => setNewClient({...newClient, email: e.target.value})}
                        className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                        placeholder="cliente@email.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Latitude</label>
                      <input 
                        required
                        disabled={isSaving}
                        type="number" 
                        step="any"
                        value={newClient.lat || ''}
                        onChange={(e) => setNewClient({...newClient, lat: parseFloat(e.target.value)})}
                        className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                        placeholder="-23.5505"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Longitude</label>
                      <input 
                        required
                        disabled={isSaving}
                        type="number" 
                        step="any"
                        value={newClient.lng || ''}
                        onChange={(e) => setNewClient({...newClient, lng: parseFloat(e.target.value)})}
                        className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                        placeholder="-46.6333"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Observações / Notas Relevantes</label>
                    <textarea 
                      disabled={isSaving}
                      value={newClient.notes}
                      onChange={(e) => setNewClient({...newClient, notes: e.target.value})}
                      className="w-full h-24 p-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 resize-none text-slate-100 disabled:opacity-50"
                      placeholder="Ex: Cliente prefere atendimento matutino. Possui acesso restrito ao telhado."
                    />
                  </div>
                </div>

                <div className="p-4 bg-[#1a1a1a] border-t border-white/10 shrink-0">
                  <button 
                    type="submit"
                    disabled={isSaving}
                    className="w-full h-12 bg-[#005bbf] text-white font-black text-xs rounded-xl shadow-lg shadow-[#005bbf]/20 hover:bg-[#004a9e] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        CADASTRANDO...
                      </>
                    ) : (
                      'CADASTRAR CLIENTE'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const ClientDetailsScreen = ({ 
  client, 
  onBack,
  onAddMaintenance,
  onAddEquipment,
  onAddEquipmentNote,
  settings,
  isSaving
}: { 
  client: Client, 
  onBack: () => void,
  onAddMaintenance: (clientId: string, equipmentIndex: number, record: MaintenanceRecord) => void,
  onAddEquipment: (clientId: string, equipment: Equipment) => void,
  onAddEquipmentNote: (clientId: string, equipmentIndex: number, note: string) => void,
  settings: AppSettings,
  isSaving: boolean
}) => {
  const [statusFilter, setStatusFilter] = useState('Todos');
  const [showMaintForm, setShowMaintForm] = useState<number | null>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isAddEqModalOpen, setIsAddEqModalOpen] = useState(false);
  const [newEqNotes, setNewEqNotes] = useState<Record<number, string>>({});
  const [newMaint, setNewMaint] = useState<MaintenanceRecord>({
    date: new Date().toLocaleDateString('pt-BR'),
    description: '',
    technician: ''
  });
  const [newEq, setNewEq] = useState<Omit<Equipment, 'maintenanceHistory'>>({
    brand: '',
    model: '',
    serial: '',
    installDate: new Date().toLocaleDateString('pt-BR'),
    installLocation: '',
    lastMaintenanceDate: new Date().toLocaleDateString('pt-BR'),
    maintenanceIntervalMonths: settings.defaultMaintenanceInterval
  });

  // Update default interval when settings change
  React.useEffect(() => {
    setNewEq(prev => ({ ...prev, maintenanceIntervalMonths: settings.defaultMaintenanceInterval }));
  }, [settings.defaultMaintenanceInterval]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      <button 
        onClick={onBack}
        className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-[#005bbf] font-black rounded-full border border-[#005bbf]/20 hover:bg-[#005bbf]/10 transition-all text-[10px] uppercase tracking-widest shadow-sm"
      >
        <ArrowLeft size={14} />
        <span>Voltar</span>
      </button>

      <section className="bg-[#1a1a1a] p-4 rounded-xl shadow-sm space-y-3">
        <h2 className="text-lg font-black text-slate-100 tracking-tight">{client.name}</h2>
        
        <div className="grid grid-cols-1 gap-2">
          <div className="flex items-center gap-2.5 text-slate-300">
            <MapPin size={14} className="text-[#005bbf]" />
            <span className="text-[10px] font-medium">{client.address}</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-300">
            <Phone size={14} className="text-[#005bbf]" />
            <span className="text-[10px] font-medium">{client.phone}</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-300">
            <Mail size={14} className="text-[#005bbf]" />
            <span className="text-[10px] font-medium">{client.email}</span>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 ml-1">
          <MapIcon size={16} className="text-slate-400" />
          <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Localização do Cliente</h3>
        </div>
        <div className="h-48 rounded-xl overflow-hidden shadow-sm border border-white/10 z-0">
          <MapWithMarker client={client} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 ml-1">
          <div className="flex items-center gap-2">
            <History size={16} className="text-slate-400" />
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Histórico de Chamados</h3>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
            {['Todos', 'Concluído', 'Em andamento', 'Pendente'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-3 h-8 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all whitespace-nowrap",
                  statusFilter === status 
                    ? "bg-[#005bbf] text-white shadow-md shadow-[#005bbf]/20" 
                    : "bg-[#1a1a1a] text-slate-400 border border-white/10 hover:bg-slate-900"
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {(isHistoryExpanded ? client.history : client.history.filter(record => statusFilter === 'Todos' || record.status === statusFilter))
            .map((record, i) => (
            <motion.div 
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={i} 
              className="bg-[#1a1a1a] p-3 rounded-xl shadow-sm flex items-center justify-between border border-white/10"
            >
              <div>
                <p className="font-bold text-slate-100 text-xs">{record.description}</p>
                <p className="text-[9px] text-slate-500 font-medium mt-0.5">{record.date}</p>
              </div>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest",
                record.status === 'Concluído' ? "bg-emerald-100 text-emerald-700" : 
                record.status === 'Em andamento' ? "bg-blue-100 text-blue-700" :
                "bg-amber-100 text-amber-700"
              )}>
                {record.status}
              </span>
            </motion.div>
          ))}
          
          {!isHistoryExpanded && client.history.filter(record => statusFilter === 'Todos' || record.status === statusFilter).length === 0 && (
            <div className="text-center py-6 bg-[#1a1a1a] rounded-xl border border-dashed border-white/10">
              <p className="text-slate-400 font-bold text-xs italic">Nenhum chamado {statusFilter.toLowerCase()} encontrado.</p>
            </div>
          )}

          <div className="flex justify-center pt-1">
            <button
              onClick={() => {
                setIsHistoryExpanded(!isHistoryExpanded);
                if (!isHistoryExpanded) setStatusFilter('Todos');
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1a1a1a] border border-[#005bbf]/20 text-[#005bbf] text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-[#005bbf] hover:text-white transition-all shadow-sm active:scale-95"
            >
              {isHistoryExpanded ? (
                <>
                  <ChevronUp size={12} />
                  Recolher Histórico
                </>
              ) : (
                <>
                  <Eye size={12} />
                  Ver Todos os Chamados
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between ml-1">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-slate-400" />
            <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Equipamentos Registrados</h3>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {client.equipment.map((eq, i) => {
            const nextMaint = calculateNextMaintenance(eq.lastMaintenanceDate, eq.maintenanceIntervalMonths);
            return (
              <div key={i} className="bg-[#2a2a2a] p-4 rounded-xl space-y-2 border border-white/10 hover:border-[#005bbf]/20 transition-all relative overflow-hidden">
                {nextMaint.isOverdue && (
                  <div className="absolute top-0 right-0 bg-[#ba1a1a] text-white text-[7px] font-black px-2 py-0.5 rounded-bl-lg uppercase tracking-widest animate-pulse">
                    Atrasado
                  </div>
                )}
                {nextMaint.isSoon && !nextMaint.isOverdue && (
                  <div className="absolute top-0 right-0 bg-[#9e4300] text-white text-[7px] font-black px-2 py-0.5 rounded-bl-lg uppercase tracking-widest">
                    Próximo
                  </div>
                )}
                
                <div className="flex justify-between items-start">
                  <span className="px-1.5 py-0.5 bg-[#005bbf] text-white text-[8px] font-black rounded uppercase tracking-wider">{eq.brand}</span>
                  <span className="text-[9px] text-slate-400 font-mono font-bold">{eq.serial}</span>
                </div>
                <div>
                  <p className="font-black text-slate-100 text-sm leading-tight">{eq.model}</p>
                  <div className="flex items-center gap-1 mt-0.5 text-[#005bbf]">
                    <MapPin size={10} />
                    <p className="text-[9px] font-bold uppercase tracking-wide">{eq.installLocation}</p>
                  </div>
                </div>
                
                <div className="pt-2 border-t border-white/10 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Última Manut.</p>
                    <p className="text-[9px] font-bold text-slate-300">{eq.lastMaintenanceDate}</p>
                  </div>
                  <div>
                    <p className={cn(
                      "text-[8px] font-black uppercase tracking-widest",
                      nextMaint.isOverdue ? "text-[#ba1a1a]" : nextMaint.isSoon ? "text-[#9e4300]" : "text-[#005bbf]"
                    )}>Próxima Manut.</p>
                    <p className={cn(
                      "text-[9px] font-bold",
                      nextMaint.isOverdue ? "text-[#ba1a1a]" : nextMaint.isSoon ? "text-[#9e4300]" : "text-slate-300"
                    )}>{nextMaint.date}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1.5">
                  <div className="flex items-center gap-1.5">
                    <History size={12} className="text-slate-400" />
                    <p className="text-[8px] font-bold text-slate-500">Intervalo: {eq.maintenanceIntervalMonths} meses</p>
                  </div>
                  <button 
                    onClick={() => setShowMaintForm(showMaintForm === i ? null : i)}
                    className="text-[9px] font-black text-[#005bbf] uppercase tracking-widest hover:underline py-1.5 px-2 bg-[#005bbf]/10 rounded-md"
                  >
                    {showMaintForm === i ? 'Fechar' : 'Ver Histórico / Registrar'}
                  </button>
                </div>

                {showMaintForm === i && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="pt-3 space-y-3 border-t border-white/10 mt-1.5"
                  >
                    <div className="space-y-1.5">
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Histórico Recente</p>
                      <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1.5 custom-scrollbar">
                        {eq.maintenanceHistory.map((m, idx) => (
                          <div key={idx} className="bg-[#2a2a2a] p-1.5 rounded-lg border border-white/10 text-[9px]">
                            <div className="flex justify-between font-bold text-slate-100">
                              <span>{m.date}</span>
                              <span className="text-[#005bbf]">{m.technician}</span>
                            </div>
                            <p className="text-slate-400 mt-0.5">{m.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#1a1a1a] p-3 rounded-lg border border-[#005bbf]/20 space-y-2.5">
                      <p className="text-[8px] font-black text-[#005bbf] uppercase tracking-widest">Notas do Equipamento</p>
                      <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1.5 custom-scrollbar">
                        {eq.notes && eq.notes.length > 0 ? (
                          eq.notes.map((note, idx) => (
                            <div key={idx} className="bg-[#2a2a2a] p-1.5 rounded-lg border border-white/10 text-[9px]">
                              <p className="text-slate-300">{note}</p>
                            </div>
                          ))
                        ) : (
                          <p className="text-[8px] text-slate-500 italic">Nenhuma nota registrada.</p>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <input 
                          type="text" 
                          placeholder="Adicionar nota..."
                          disabled={isSaving}
                          value={newEqNotes[i] || ''}
                          onChange={(e) => setNewEqNotes({...newEqNotes, [i]: e.target.value})}
                          className="flex-1 h-8 px-2.5 bg-[#2a2a2a] border-none rounded-md text-[10px] font-bold text-slate-100 disabled:opacity-50"
                        />
                        <button 
                          disabled={isSaving || !newEqNotes[i]?.trim()}
                          onClick={() => {
                            if (newEqNotes[i]?.trim()) {
                              onAddEquipmentNote(client.id, i, newEqNotes[i].trim());
                              setNewEqNotes({...newEqNotes, [i]: ''});
                            }
                          }}
                          className="px-3 h-8 bg-[#005bbf] text-white text-[10px] font-black rounded-md uppercase tracking-widest hover:bg-[#004a9c] transition-colors disabled:opacity-50 flex items-center justify-center"
                        >
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
                        </button>
                      </div>
                    </div>

                    <div className="bg-[#1a1a1a] p-3 rounded-lg border border-[#005bbf]/20 space-y-2.5">
                      <p className="text-[8px] font-black text-[#005bbf] uppercase tracking-widest">Nova Manutenção</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Data</label>
                          <input 
                            type="text" 
                            disabled={isSaving}
                            value={newMaint.date}
                            onChange={(e) => setNewMaint({...newMaint, date: e.target.value})}
                            className="w-full h-8 px-2.5 bg-[#2a2a2a] border-none rounded-md text-[10px] font-bold text-slate-100 disabled:opacity-50"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Técnico</label>
                          <input 
                            type="text" 
                            disabled={isSaving}
                            placeholder="Nome"
                            value={newMaint.technician}
                            onChange={(e) => setNewMaint({...newMaint, technician: e.target.value})}
                            className="w-full h-8 px-2.5 bg-[#2a2a2a] border-none rounded-md text-[10px] font-bold text-slate-100 disabled:opacity-50"
                          />
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Descrição do Serviço</label>
                        <textarea 
                          disabled={isSaving}
                          placeholder="O que foi feito?"
                          value={newMaint.description}
                          onChange={(e) => setNewMaint({...newMaint, description: e.target.value})}
                          className="w-full h-16 p-2.5 bg-[#2a2a2a] border-none rounded-md text-[10px] font-bold resize-none text-slate-100 disabled:opacity-50"
                        />
                      </div>
                      <button 
                        disabled={isSaving}
                        onClick={() => {
                          if (newMaint.description && newMaint.technician) {
                            onAddMaintenance(client.id, i, newMaint);
                            setNewMaint({
                              date: new Date().toLocaleDateString('pt-BR'),
                              description: '',
                              technician: ''
                            });
                            setShowMaintForm(null);
                          }
                        }}
                        className="w-full h-8 bg-[#005bbf] text-white text-[9px] font-black rounded-md uppercase tracking-widest hover:bg-[#004a9c] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSaving ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            SALVANDO...
                          </>
                        ) : (
                          'SALVAR REGISTRO'
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 ml-1">
          <Info size={16} className="text-slate-400" />
          <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Notas Relevantes</h3>
        </div>
        <div className="bg-[#ffdbcb]/30 p-4 rounded-xl border-l-4 border-[#9e4300]">
          <ul className="list-disc list-inside space-y-1.5">
            {client.notes.map((note, i) => (
              <li key={i} className="text-xs font-medium text-[#783100]">{note}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Floating Action Button for New Equipment */}
      <button 
        onClick={() => setIsAddEqModalOpen(true)}
        className="fixed bottom-24 right-4 w-12 h-12 bg-[#005bbf] text-white rounded-full shadow-2xl shadow-[#005bbf]/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-40"
      >
        <Plus size={24} />
      </button>

      {/* Add Equipment Modal */}
      <AnimatePresence>
        {isAddEqModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddEqModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-[#1a1a1a] w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center bg-[#1a1a1a] shrink-0">
                <h3 className="text-base font-black text-slate-100">Novo Equipamento</h3>
                <button onClick={() => setIsAddEqModalOpen(false)} className="p-1.5 hover:bg-slate-800 rounded-full transition-colors">
                  <X size={16} className="text-slate-400" />
                </button>
              </div>
              
              <div className="flex flex-col overflow-hidden">
                <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Marca</label>
                      <input 
                        type="text" 
                        disabled={isSaving}
                        value={newEq.brand}
                        onChange={(e) => setNewEq({...newEq, brand: e.target.value})}
                        className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                        placeholder="Ex: Carrier"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Modelo</label>
                      <input 
                        type="text" 
                        disabled={isSaving}
                        value={newEq.model}
                        onChange={(e) => setNewEq({...newEq, model: e.target.value})}
                        className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                        placeholder="Ex: 42XQA012515KC"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Número de Série</label>
                    <input 
                      type="text" 
                      disabled={isSaving}
                      value={newEq.serial}
                      onChange={(e) => setNewEq({...newEq, serial: e.target.value})}
                      className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                      placeholder="Ex: 123456789"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Local de Instalação</label>
                    <input 
                      type="text" 
                      disabled={isSaving}
                      value={newEq.installLocation}
                      onChange={(e) => setNewEq({...newEq, installLocation: e.target.value})}
                      className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                      placeholder="Ex: Sala de Reunião"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Intervalo de Manutenção (Meses)</label>
                    <input 
                      type="number" 
                      disabled={isSaving}
                      value={newEq.maintenanceIntervalMonths}
                      onChange={(e) => setNewEq({...newEq, maintenanceIntervalMonths: parseInt(e.target.value)})}
                      className="w-full h-10 px-3 bg-[#2a2a2a] border-none rounded-lg text-xs font-semibold focus:ring-2 focus:ring-[#005bbf]/40 text-slate-100 disabled:opacity-50"
                    />
                    <p className="text-[8px] text-slate-500 italic ml-1">* Valor padrão: {settings.defaultMaintenanceInterval} meses</p>
                  </div>
                </div>

                <div className="p-4 bg-[#1a1a1a] border-t border-white/10 shrink-0">
                  <button 
                    disabled={isSaving}
                    onClick={() => {
                      onAddEquipment(client.id, { ...newEq, maintenanceHistory: [] });
                      setIsAddEqModalOpen(false);
                      setNewEq({
                        brand: '',
                        model: '',
                        serial: '',
                        installDate: new Date().toLocaleDateString('pt-BR'),
                        installLocation: '',
                        lastMaintenanceDate: new Date().toLocaleDateString('pt-BR'),
                        maintenanceIntervalMonths: settings.defaultMaintenanceInterval
                      });
                    }}
                    className="w-full h-12 bg-[#005bbf] text-white font-black text-xs rounded-xl shadow-lg shadow-[#005bbf]/20 hover:bg-[#004a9e] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        ADICIONANDO...
                      </>
                    ) : (
                      'ADICIONAR EQUIPAMENTO'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const LoginScreen = () => {
  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login Error:", error);
      if (error.code === 'auth/network-request-failed') {
        toast.error("Erro de rede ao fazer login. Verifique se o domínio run.app está autorizado no console do Firebase.");
      } else {
        toast.error(`Erro ao fazer login: ${error.message}`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-[#1a1a1a] p-8 rounded-3xl border border-white/5 shadow-2xl space-y-8 text-center">
        <div className="w-20 h-20 bg-[#005bbf] rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-[#005bbf]/20">
          <Zap size={40} className="text-white" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-black text-slate-100 tracking-tight">Amigo Refrigerista Pro</h1>
          <p className="text-slate-400 font-medium text-sm">Faça login para gerenciar seus clientes e equipamentos.</p>
        </div>
        <button 
          onClick={handleLogin}
          className="w-full h-12 bg-white text-slate-900 font-black rounded-xl flex items-center justify-center gap-3 hover:bg-slate-200 transition-all shadow-lg text-xs"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          ENTRAR COM GOOGLE
        </button>
      </div>
    </div>
  );
};

// --- Main App ---

export default function AmigoApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState('dash');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState<{ visible: boolean, message: string }>({ visible: false, message: '' });
  const [settings, setSettings] = useState<AppSettings>({
    defaultMaintenanceInterval: 6,
    notifications: {
      maintenanceAlerts: true,
      pendingCalls: true,
      newFeatures: true
    }
  });

  const triggerSuccess = (message: string) => {
    setShowSuccess({ visible: true, message });
    setTimeout(() => setShowSuccess({ visible: false, message: '' }), 2500);
  };

  // Auth Listener
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Data Fetching
  React.useEffect(() => {
    if (!isAuthReady || !user) return;

    const clientsRef = collection(db, `users/${user.uid}/clients`);
    const unsubscribeClients = onSnapshot(clientsRef, (snapshot) => {
      const loadedClients: Client[] = [];
      snapshot.forEach(doc => {
        loadedClients.push({ id: doc.id, ...doc.data() } as Client);
      });
      setClients(loadedClients);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/clients`);
    });

    const settingsRef = doc(db, `users/${user.uid}/settings/appSettings`);
    const unsubscribeSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as AppSettings;
        setSettings({
          ...data,
          notifications: data.notifications || {
            maintenanceAlerts: true,
            pendingCalls: true,
            newFeatures: true
          }
        });
      } else {
        const defaultSettings: AppSettings = {
          defaultMaintenanceInterval: 6,
          notifications: {
            maintenanceAlerts: true,
            pendingCalls: true,
            newFeatures: true
          }
        };
        setDoc(settingsRef, defaultSettings).catch(e => {
          handleFirestoreError(e, OperationType.CREATE, `users/${user.uid}/settings/appSettings`);
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/settings/appSettings`);
    });

    const notifRef = collection(db, `users/${user.uid}/notifications`);
    const unsubscribeNotif = onSnapshot(notifRef, (snapshot) => {
      const loadedNotifs: AppNotification[] = [];
      snapshot.forEach(doc => {
        loadedNotifs.push({ id: doc.id, ...doc.data() } as AppNotification);
      });
      setNotifications(loadedNotifs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/notifications`);
    });

    return () => {
      unsubscribeClients();
      unsubscribeSettings();
      unsubscribeNotif();
    };
  }, [user, isAuthReady]);

  // Scan for notifications
  React.useEffect(() => {
    const newNotifications: AppNotification[] = [];
    
    clients.forEach(client => {
      // Check for pending calls
      client.history.forEach(record => {
        if (record.status === 'Pendente') {
          newNotifications.push({
            id: `pending-${client.id}-${record.date}`,
            title: 'Chamado Pendente',
            message: `O cliente ${client.name} tem um chamado pendente: ${record.description}`,
            type: 'pending_call',
            date: record.date,
            read: false,
            clientId: client.id
          });
        }
      });

      // Check for upcoming maintenance
      client.equipment.forEach(eq => {
        const nextMaint = calculateNextMaintenance(eq.lastMaintenanceDate, eq.maintenanceIntervalMonths);
        if (nextMaint.isSoon || nextMaint.isOverdue) {
          newNotifications.push({
            id: `maint-${client.id}-${eq.serial}`,
            title: nextMaint.isOverdue ? 'Manutenção Atrasada' : 'Manutenção Próxima',
            message: `Equipamento ${eq.model} (${client.name}) precisa de manutenção.`,
            type: 'maintenance',
            date: nextMaint.date,
            read: false,
            clientId: client.id
          });
        }
      });
    });

    // Only add if not already present (simulated)
    setNotifications(prev => {
      const existingIds = new Set(prev.map(n => n.id));
      const filtered = newNotifications.filter(n => !existingIds.has(n.id));
      
      if (filtered.length > 0) {
        filtered.forEach(n => {
          toast(n.title, {
            description: n.message,
            action: {
              label: 'Ver',
              onClick: () => {
                if (n.clientId) {
                  const c = clients.find(cl => cl.id === n.clientId);
                  if (c) {
                    setSelectedClient(c);
                    setActiveTab('clients');
                  }
                }
              }
            }
          });
        });
        return [...filtered, ...prev];
      }
      return prev;
    });
  }, [clients]);

  const handleMarkAsRead = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, `users/${user.uid}/notifications`, id), { read: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/notifications/${id}`);
    }
  };

  const handleSelectClientFromNotif = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client) {
      setSelectedClient(client);
      setActiveTab('clients');
      setIsNotificationCenterOpen(false);
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedClient(null); // Reset client view when switching tabs
  };

  const handleAddClient = async (newClientData: Omit<Client, 'id' | 'history' | 'equipment' | 'notes'> & { notes?: string }) => {
    if (!user) return;
    const { notes, ...rest } = newClientData;
    setIsSaving(true);
    
    try {
      const clientsRef = collection(db, `users/${user.uid}/clients`);
      const newDocRef = doc(clientsRef);
      const newClientId = newDocRef.id;

      const newClient: Client = {
        ...rest,
        id: newClientId,
        history: [],
        equipment: [],
        notes: notes ? [notes] : []
      };

      await setDoc(newDocRef, newClient);
      triggerSuccess('Cliente cadastrado!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/clients`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddMaintenance = async (clientId: string, equipmentIndex: number, record: MaintenanceRecord) => {
    if (!user) return;
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    setIsSaving(true);
    const updatedEquipment = [...client.equipment];
    const eq = { ...updatedEquipment[equipmentIndex] };
    eq.maintenanceHistory = [record, ...eq.maintenanceHistory];
    eq.lastMaintenanceDate = record.date;
    updatedEquipment[equipmentIndex] = eq;

    const newServiceRecord: ServiceRecord = {
      date: record.date,
      description: `[${eq.model}] ${record.description}`,
      status: 'Concluído'
    };

    const updatedHistory = [newServiceRecord, ...client.history];

    try {
      await updateDoc(doc(db, `users/${user.uid}/clients`, clientId), {
        equipment: updatedEquipment,
        history: updatedHistory
      });
      
      if (selectedClient && selectedClient.id === clientId) {
        setSelectedClient({
          ...client,
          equipment: updatedEquipment,
          history: updatedHistory
        });
      }
      triggerSuccess('Manutenção registrada!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/clients/${clientId}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddEquipment = async (clientId: string, equipment: Equipment) => {
    if (!user) return;
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    setIsSaving(true);
    const updatedEquipment = [equipment, ...client.equipment];

    try {
      await updateDoc(doc(db, `users/${user.uid}/clients`, clientId), {
        equipment: updatedEquipment
      });
      
      if (selectedClient && selectedClient.id === clientId) {
        setSelectedClient({
          ...client,
          equipment: updatedEquipment
        });
      }
      triggerSuccess('Equipamento salvo!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/clients/${clientId}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddEquipmentNote = async (clientId: string, equipmentIndex: number, note: string) => {
    if (!user) return;
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    setIsSaving(true);
    const updatedEquipment = [...client.equipment];
    const eq = { ...updatedEquipment[equipmentIndex] };
    eq.notes = [...(eq.notes || []), note];
    updatedEquipment[equipmentIndex] = eq;

    try {
      await updateDoc(doc(db, `users/${user.uid}/clients`, clientId), {
        equipment: updatedEquipment
      });
      
      if (selectedClient && selectedClient.id === clientId) {
        setSelectedClient({
          ...client,
          equipment: updatedEquipment
        });
      }
      triggerSuccess('Nota adicionada!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/clients/${clientId}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSettings = async (newSettings: AppSettings) => {
    if (!user) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db, `users/${user.uid}/settings`, 'appSettings'), newSettings);
      setSettings(newSettings);
      triggerSuccess('Configurações salvas!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}/settings/appSettings`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Erro ao sair da conta.');
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#005bbf] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-32">
      <Toaster position="top-center" richColors theme="dark" />
      <Header 
        onOpenNotifications={() => setIsNotificationCenterOpen(true)} 
        onOpenSettings={() => setActiveTab('settings')}
        unreadCount={notifications.filter(n => !n.read).length} 
        user={user}
        onLogout={handleLogout}
      />

      <AnimatePresence>
        {isNotificationCenterOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNotificationCenterOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]"
            />
            <NotificationCenter 
              notifications={notifications}
              onClose={() => setIsNotificationCenterOpen(false)}
              onMarkAsRead={handleMarkAsRead}
              onSelectClient={handleSelectClientFromNotif}
            />
          </>
        )}
      </AnimatePresence>
      
      <main className="pt-24 px-6 max-w-lg mx-auto md:max-w-4xl">
        <AnimatePresence mode="wait">
          {activeTab === 'dash' && (
            <DashboardScreen 
              key="dash" 
              clients={clients} 
              onSelectClient={(client) => {
                setSelectedClient(client);
                setActiveTab('clients');
              }} 
            />
          )}
          {activeTab === 'errors' && <ErrorCodesScreen key="errors" />}
          {activeTab === 'calc' && (
            <div key="calc" className="space-y-6">
              <section>
                <h2 className="text-xl font-black tracking-tight text-slate-100 mb-1">Calculadora Térmica</h2>
                <p className="text-slate-500 text-[10px] font-medium">Calcule a carga térmica necessária para o ambiente.</p>
              </section>
              <ThermalCalculator />
            </div>
          )}
          {activeTab === 'settings' && (
            <SettingsScreen 
              key="settings" 
              settings={settings} 
              onUpdateSettings={handleUpdateSettings} 
              isSaving={isSaving}
            />
          )}
          {activeTab === 'clients' && (
            <div key="clients">
              {selectedClient ? (
                <ClientDetailsScreen 
                  client={selectedClient} 
                  onBack={() => setSelectedClient(null)} 
                  onAddMaintenance={handleAddMaintenance}
                  onAddEquipment={handleAddEquipment}
                  onAddEquipmentNote={handleAddEquipmentNote}
                  settings={settings}
                  isSaving={isSaving}
                />
              ) : (
                <ClientsScreen 
                  clients={clients}
                  onSelectClient={setSelectedClient} 
                  onAddClient={handleAddClient}
                  isSaving={isSaving}
                />
              )}
            </div>
          )}
        </AnimatePresence>
      </main>

      <SuccessAnimation show={showSuccess.visible} message={showSuccess.message} />
      <BottomNav activeTab={activeTab} setActiveTab={handleTabChange} />
    </div>
  );
}
