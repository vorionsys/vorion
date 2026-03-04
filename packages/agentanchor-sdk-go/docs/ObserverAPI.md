# \ObserverAPI

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ListAnomalies**](ObserverAPI.md#ListAnomalies) | **Get** /observer/anomalies | List anomalies
[**QueryObserverEvents**](ObserverAPI.md#QueryObserverEvents) | **Get** /observer/events | Query events



## ListAnomalies

> ListAnomalies200Response ListAnomalies(ctx).AgentId(agentId).Status(status).Execute()

List anomalies



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
	agentId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	status := "status_example" // string |  (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ObserverAPI.ListAnomalies(context.Background()).AgentId(agentId).Status(status).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ObserverAPI.ListAnomalies``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListAnomalies`: ListAnomalies200Response
	fmt.Fprintf(os.Stdout, "Response from `ObserverAPI.ListAnomalies`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListAnomaliesRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **agentId** | **string** |  | 
 **status** | **string** |  | 

### Return type

[**ListAnomalies200Response**](ListAnomalies200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## QueryObserverEvents

> QueryObserverEvents200Response QueryObserverEvents(ctx).AgentId(agentId).EventType(eventType).Severity(severity).Since(since).Limit(limit).Execute()

Query events



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
    "time"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	agentId := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string |  (optional)
	eventType := "eventType_example" // string |  (optional)
	severity := "severity_example" // string |  (optional)
	since := time.Now() // time.Time |  (optional)
	limit := int32(56) // int32 |  (optional) (default to 100)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.ObserverAPI.QueryObserverEvents(context.Background()).AgentId(agentId).EventType(eventType).Severity(severity).Since(since).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `ObserverAPI.QueryObserverEvents``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `QueryObserverEvents`: QueryObserverEvents200Response
	fmt.Fprintf(os.Stdout, "Response from `ObserverAPI.QueryObserverEvents`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiQueryObserverEventsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **agentId** | **string** |  | 
 **eventType** | **string** |  | 
 **severity** | **string** |  | 
 **since** | **time.Time** |  | 
 **limit** | **int32** |  | [default to 100]

### Return type

[**QueryObserverEvents200Response**](QueryObserverEvents200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

