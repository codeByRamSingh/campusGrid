import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";
const prisma = new PrismaClient();
async function main() {
    const trust = await prisma.trust.upsert({
        where: { registrationNumber: "BR/2004/1787" },
        update: {
            name: "Mother Teresa Educational Trust",
            establishmentYear: 2004,
        },
        create: {
            name: "Mother Teresa Educational Trust",
            establishmentYear: 2004,
            registrationNumber: "BR/2004/1787",
        },
    });
    const passwordHash = await hashPassword("Admin@123");
    await prisma.user.upsert({
        where: { email: "super_admin@campusgrid.local" },
        update: { role: "SUPER_ADMIN", passwordHash },
        create: {
            email: "super_admin@campusgrid.local",
            passwordHash,
            role: "SUPER_ADMIN",
        },
    });
    await prisma.college.upsert({
        where: { code: "MAIN-001" },
        update: {},
        create: {
            trustId: trust.id,
            name: "Mother Teresa Institute of Management",
            code: "MAIN-001",
            registrationYear: 2005,
            address: "Patna, Bihar, India",
            university: "Aryabhatta Knowledge University",
            startingRollNumber: 1000,
            startingAdmissionNumber: 5000,
        },
    });
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
