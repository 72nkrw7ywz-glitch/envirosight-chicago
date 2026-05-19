import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from "react-native";

type ContactInfo = {
  name: string;
  description: string;
  phone?: string;
  url?: string;
};

const EMERGENCY_CONTACTS: ContactInfo[] = [
  {
    name: "EPA Region 5 (Chicago)",
    description: "Federal environmental enforcement for IL, IN, MI, MN, OH, WI",
    phone: "312-353-2000",
    url: "https://www.epa.gov/aboutepa/epa-region-5",
  },
  {
    name: "Illinois EPA",
    description: "State environmental complaints and pollution reporting",
    phone: "217-782-3397",
    url: "https://epa.illinois.gov",
  },
  {
    name: "Chicago Department of Public Health",
    description: "Air quality and environmental health concerns",
    phone: "312-746-7425",
    url: "https://www.chicago.gov/city/en/depts/cdph.html",
  },
  {
    name: "National Response Center (Spills)",
    description: "Report oil/chemical spills, 24/7 hotline (US Coast Guard)",
    phone: "800-424-8802",
    url: "https://www.epa.gov/emergency-response/national-response-center",
  },
];

const ADVOCACY_ORGS: ContactInfo[] = [
  {
    name: "Little Village Environmental Justice Organization",
    description: "Community-led EJ organization in Southwest Chicago (since 1994)",
    url: "https://lvejo.org",
  },
  {
    name: "Southeast Environmental Task Force",
    description: "Fighting industrial pollution in Southeast Chicago",
    url: "https://www.setaskforce.org",
  },
  {
    name: "People for Community Recovery",
    description: "Altgeld Gardens environmental justice (founded by Hazel Johnson)",
    url: "https://peopleforcommunityrecovery.org",
  },
  {
    name: "Environmental Law & Policy Center",
    description: "Midwest's leading environmental advocacy organization",
    url: "https://elpc.org",
  },
  {
    name: "Sierra Club Illinois",
    description: "State-level environmental advocacy and lobbying",
    url: "https://www.sierraclub.org/illinois",
  },
];

const ACTION_STEPS = [
  {
    title: "Report Pollution",
    icon: "🚨",
    description: "If you see illegal dumping, smoke, odors, or contaminated water, document it (photos, time, location) and call the EPA hotline or Illinois EPA.",
  },
  {
    title: "File a Complaint",
    icon: "📝",
    description: "Use EPA's online complaint form for formal violations. Include facility name, date, and what you observed.",
  },
  {
    title: "Attend Public Hearings",
    icon: "🗣️",
    description: "Permits for new polluting facilities require public comment periods. Show up — your voice counts more in EJ-impacted areas.",
  },
  {
    title: "Contact Your Alderperson",
    icon: "🏛️",
    description: "Local zoning decisions affect what facilities can be built. Find your alderperson at chicago.gov.",
  },
  {
    title: "Join a Local Group",
    icon: "🤝",
    description: "Community organizations have legal, technical, and organizing resources. They've been doing this work for decades.",
  },
  {
    title: "Track Air Quality",
    icon: "🌫️",
    description: "Use AirNow or this app to monitor your neighborhood. Document patterns and share data with advocacy groups.",
  },
];

export default function ActionScreen() {
  const handleCall = (phone: string) => {
    Linking.openURL(`tel:${phone.replace(/-/g, "")}`).catch(() => {});
  };

  const handleLink = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  const handleEPAComplaint = () => {
    Linking.openURL("https://echo.epa.gov/report-environmental-violations").catch(() => {});
  };

  const handleFindAlderperson = () => {
    Linking.openURL("https://www.chicago.gov/city/en/about/wards.html").catch(() => {});
  };

  return (
    <ScrollView style={styles.page}>
      <View style={styles.hero}>
        <Text style={styles.title}>Take Action</Text>
        <Text style={styles.subtitle}>Your environment, your voice</Text>
        <Text style={styles.description}>
          Environmental justice depends on community engagement. Use these resources to report
          pollution, connect with advocacy groups, and make your voice heard.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🚨 Report Pollution</Text>
        <Text style={styles.bodyText}>
          If you witness illegal pollution, document it immediately and contact authorities.
        </Text>
        <Pressable onPress={handleEPAComplaint} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>File EPA Complaint Online</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>How to Take Action</Text>
        {ACTION_STEPS.map((step, i) => (
          <View key={i} style={styles.actionStep}>
            <Text style={styles.actionIcon}>{step.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>{step.title}</Text>
              <Text style={styles.actionDescription}>{step.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📞 Emergency & Reporting Contacts</Text>
        <Text style={styles.bodyText}>Government agencies for pollution reporting and enforcement.</Text>
        {EMERGENCY_CONTACTS.map((contact, i) => (
          <View key={i} style={styles.contactCard}>
            <Text style={styles.contactName}>{contact.name}</Text>
            <Text style={styles.contactDescription}>{contact.description}</Text>
            <View style={styles.contactButtons}>
              {contact.phone && (
                <Pressable onPress={() => handleCall(contact.phone!)} style={styles.contactButton}>
                  <Text style={styles.contactButtonText}>📞 {contact.phone}</Text>
                </Pressable>
              )}
              {contact.url && (
                <Pressable onPress={() => handleLink(contact.url!)} style={styles.contactButtonSecondary}>
                  <Text style={styles.contactButtonSecondaryText}>🌐 Website</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🤝 Community Advocacy Groups</Text>
        <Text style={styles.bodyText}>
          Local organizations doing environmental justice work in Chicago neighborhoods.
        </Text>
        {ADVOCACY_ORGS.map((org, i) => (
          <View key={i} style={styles.contactCard}>
            <Text style={styles.contactName}>{org.name}</Text>
            <Text style={styles.contactDescription}>{org.description}</Text>
            {org.url && (
              <Pressable onPress={() => handleLink(org.url!)} style={styles.contactButton}>
                <Text style={styles.contactButtonText}>🌐 Visit Website</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🏛️ Local Government</Text>
        <Text style={styles.bodyText}>
          Your alderperson controls zoning decisions in your ward. New polluting facilities
          often need their approval.
        </Text>
        <Pressable onPress={handleFindAlderperson} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Find Your Alderperson</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📚 Know Your Rights</Text>
        <Text style={styles.bodyText}>
          Under federal law, you have the right to clean air and water. Key protections include:
        </Text>
        <View style={styles.rightsList}>
          <Text style={styles.rightItem}>• Clean Air Act — limits on industrial air pollution</Text>
          <Text style={styles.rightItem}>• Clean Water Act — protects drinking water and waterways</Text>
          <Text style={styles.rightItem}>• Safe Drinking Water Act — sets standards for public water</Text>
          <Text style={styles.rightItem}>• Toxic Substances Control Act — regulates chemicals</Text>
          <Text style={styles.rightItem}>• Civil Rights Act Title VI — environmental discrimination protection</Text>
        </View>
        <Pressable onPress={() => handleLink("https://www.epa.gov/environmentaljustice")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Learn More About EJ Rights</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>💡 Document Your Experience</Text>
        <Text style={styles.bodyText}>
          When reporting pollution, include:
        </Text>
        <View style={styles.rightsList}>
          <Text style={styles.rightItem}>• Date and time of observation</Text>
          <Text style={styles.rightItem}>• Exact location and nearby facility names</Text>
          <Text style={styles.rightItem}>• Photos or videos if safe to take</Text>
          <Text style={styles.rightItem}>• Description of what you observed (smoke color, odor, etc.)</Text>
          <Text style={styles.rightItem}>• Health symptoms you or others experienced</Text>
          <Text style={styles.rightItem}>• Weather conditions (wind direction matters)</Text>
        </View>
      </View>

      <Text style={styles.footer}>
        EnviroSight Chicago · Empowering communities through environmental data
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f6faf7" },
  hero: { backgroundColor: "#075f43", padding: 34, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  title: { color: "white", fontSize: 38, fontWeight: "800", marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { color: "#a7f3d0", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  description: { color: "rgba(255,255,255,0.92)", fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: "white", marginHorizontal: 20, marginTop: 20, padding: 22, borderRadius: 18, borderWidth: 1, borderColor: "#e5e7eb" },
  cardTitle: { fontSize: 22, fontWeight: "800", color: "#075f43", marginBottom: 12 },
  bodyText: { fontSize: 14, lineHeight: 22, color: "#374151", marginBottom: 12 },
  primaryButton: { backgroundColor: "#c62828", padding: 14, borderRadius: 12, alignItems: "center", marginTop: 8 },
  primaryButtonText: { color: "white", fontWeight: "800", fontSize: 15 },
  secondaryButton: { backgroundColor: "#075f43", padding: 14, borderRadius: 12, alignItems: "center", marginTop: 8 },
  secondaryButtonText: { color: "white", fontWeight: "800", fontSize: 15 },
  actionStep: { flexDirection: "row", gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  actionIcon: { fontSize: 28, width: 36 },
  actionTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 4 },
  actionDescription: { fontSize: 13, lineHeight: 20, color: "#6b7280" },
  contactCard: { backgroundColor: "#f7fbf8", padding: 14, borderRadius: 12, marginTop: 10, borderLeftWidth: 3, borderLeftColor: "#075f43" },
  contactName: { fontSize: 15, fontWeight: "800", color: "#111827", marginBottom: 4 },
  contactDescription: { fontSize: 13, color: "#6b7280", marginBottom: 10, lineHeight: 18 },
  contactButtons: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  contactButton: { backgroundColor: "#075f43", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  contactButtonText: { color: "white", fontWeight: "800", fontSize: 12 },
  contactButtonSecondary: { backgroundColor: "white", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#075f43" },
  contactButtonSecondaryText: { color: "#075f43", fontWeight: "800", fontSize: 12 },
  rightsList: { marginTop: 8, marginBottom: 8 },
  rightItem: { fontSize: 13, lineHeight: 24, color: "#374151" },
  footer: { textAlign: "center", color: "#9ca3af", fontSize: 12, marginTop: 20, paddingHorizontal: 20 },
});