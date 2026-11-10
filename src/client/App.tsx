import { Home } from './pages/Home';
import { RoomPage } from './pages/RoomPage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  if (route.page === 'room') return <RoomPage key={route.roomId} roomId={route.roomId} />;
  return <Home />;
}
