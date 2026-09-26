import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES, BookingRemindersJobData } from "../queues";
import { AppointmentService } from "../../appointment/appointmentService";

// Sends appointment reminders for whichever window the job names. Duplicate
// suppression lives in the NotificationLog (see sendDueReminders), so an
// overlapping run is harmless.
export const createBookingReminderWorker =
  (): Worker<BookingRemindersJobData> => {
    const connection = getRedisConnection();
    if (!connection) {
      throw new Error(
        "createBookingReminderWorker called without a Redis connection",
      );
    }

    const appointments = new AppointmentService();

    const worker = new Worker<BookingRemindersJobData>(
      QUEUE_NAMES.bookingReminders,
      async (job) => {
        const result = await appointments.sendDueReminders(
          job.data.window ?? "24H",
        );
        // Only log a sweep that did something — two schedules running all day
        // would otherwise fill the logs with zeroes.
        if (result.sent > 0 || result.errors.length > 0) {
          console.log("Booking reminders:", result);
        }
        return result;
      },
      { connection, concurrency: 1 },
    );

    worker.on("failed", (job, err) => {
      console.error(
        `Booking reminder job ${job?.id} (${job?.data?.window}) failed: ${err.message}`,
      );
    });

    return worker;
  };
