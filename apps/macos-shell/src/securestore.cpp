#include "securestore.h"

#include <QtConcurrentRun>

#include <Security/Security.h>

namespace {

CFMutableDictionaryRef makeQuery() {
    CFMutableDictionaryRef query = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(query, kSecAttrService, CFSTR("com.chriscorbell.kino"));
    CFDictionarySetValue(query, kSecAttrAccount, CFSTR("stremio-account-auth-v1"));
    return query;
}

QVariantMap readAuth() {
    CFMutableDictionaryRef query = makeQuery();
    CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
    CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);

    CFTypeRef result = nullptr;
    const OSStatus status = SecItemCopyMatching(query, &result);
    CFRelease(query);
    if (status == errSecItemNotFound) {
        return {{QStringLiteral("ok"), true}, {QStringLiteral("value"), QString{}}};
    }
    if (status != errSecSuccess || !result || CFGetTypeID(result) != CFDataGetTypeID()) {
        if (result) {
            CFRelease(result);
        }
        qWarning("[kino:keychain] read failed status=%d", static_cast<int>(status));
        return {{QStringLiteral("ok"), false}, {QStringLiteral("value"), QString{}}};
    }

    const auto data = static_cast<CFDataRef>(result);
    const QString value = QString::fromUtf8(
        reinterpret_cast<const char *>(CFDataGetBytePtr(data)), CFDataGetLength(data));
    CFRelease(result);
    return {{QStringLiteral("ok"), true}, {QStringLiteral("value"), value}};
}

bool writeAuth(const QString &value) {
    const QByteArray encoded = value.toUtf8();
    CFDataRef data = CFDataCreate(kCFAllocatorDefault,
                                  reinterpret_cast<const UInt8 *>(encoded.constData()),
                                  encoded.size());
    CFMutableDictionaryRef query = makeQuery();
    CFMutableDictionaryRef attributes = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(attributes, kSecValueData, data);

    OSStatus status = SecItemUpdate(query, attributes);
    if (status == errSecItemNotFound) {
        CFDictionarySetValue(query, kSecValueData, data);
        status = SecItemAdd(query, nullptr);
    }

    CFRelease(attributes);
    CFRelease(query);
    CFRelease(data);
    if (status != errSecSuccess) {
        qWarning("[kino:keychain] write failed status=%d", static_cast<int>(status));
        return false;
    }
    return true;
}

bool clearAuth() {
    CFMutableDictionaryRef query = makeQuery();
    const OSStatus status = SecItemDelete(query);
    CFRelease(query);
    if (status != errSecSuccess && status != errSecItemNotFound) {
        qWarning("[kino:keychain] delete failed status=%d", static_cast<int>(status));
        return false;
    }
    return true;
}

} // namespace

QFuture<bool> SecureStore::clearStremioAuth() {
    return QtConcurrent::run(clearAuth);
}

QFuture<QVariantMap> SecureStore::readStremioAuth() {
    return QtConcurrent::run(readAuth);
}

QFuture<bool> SecureStore::writeStremioAuth(const QString &value) {
    return QtConcurrent::run([value]() { return writeAuth(value); });
}
