import { EventCard } from "@/components/EventCard";
import { MapControls } from "@/components/map/MapControls";
import { MapSlot } from "@/components/map/MapSlot";
import { LINE_NAME } from "@/mocks/plant";

export default function RealtimePage() {
  return (
    <>
      <MapSlot />
      <MapControls />
      <EventCard context={LINE_NAME} />
    </>
  );
}
