# \NotificationsAPI

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ListNotifications**](NotificationsAPI.md#ListNotifications) | **Get** /notifications | List notifications
[**MarkNotificationsRead**](NotificationsAPI.md#MarkNotificationsRead) | **Patch** /notifications | Mark notifications read



## ListNotifications

> ListNotifications200Response ListNotifications(ctx).UnreadOnly(unreadOnly).Limit(limit).Execute()

List notifications



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	unreadOnly := true // bool |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 50)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.NotificationsAPI.ListNotifications(context.Background()).UnreadOnly(unreadOnly).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `NotificationsAPI.ListNotifications``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListNotifications`: ListNotifications200Response
	fmt.Fprintf(os.Stdout, "Response from `NotificationsAPI.ListNotifications`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListNotificationsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **unreadOnly** | **bool** |  | 
 **limit** | **int32** |  | [default to 50]

### Return type

[**ListNotifications200Response**](ListNotifications200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## MarkNotificationsRead

> MarkNotificationsRead(ctx).MarkNotificationsReadRequest(markNotificationsReadRequest).Execute()

Mark notifications read

### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	markNotificationsReadRequest := *openapiclient.NewMarkNotificationsReadRequest() // MarkNotificationsReadRequest |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.NotificationsAPI.MarkNotificationsRead(context.Background()).MarkNotificationsReadRequest(markNotificationsReadRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `NotificationsAPI.MarkNotificationsRead``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiMarkNotificationsReadRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **markNotificationsReadRequest** | [**MarkNotificationsReadRequest**](MarkNotificationsReadRequest.md) |  | 

### Return type

 (empty response body)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

